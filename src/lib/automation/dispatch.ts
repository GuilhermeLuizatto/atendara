import { AUTOMATION_TASK_META, DISPATCH_CLOCK_SKEW_SECONDS } from "@/config/automation";
import { applyAttempt, type AttemptResult } from "@/lib/notifications/delivery";
import { evaluateConversationReply, recheckBeforeSend } from "@/lib/notifications/eligibility";
import type { ReplyContext } from "@/lib/notifications/replies";
import { hashBody } from "@/lib/notifications/templates";
import type { SendRequest } from "@/lib/notifications/providers/types";
import type {
  Appointment,
  AutomationDispatchPayload,
  AutomationStopReason,
  AutomationTask,
  Client,
  Conversation,
  ISODateString,
  MessagingSender,
  NotificationDelivery,
  Organization,
  ProfessionConfig,
} from "@/types";
import { isConversationReplyEvent } from "@/types";

import { alertEffect, auditEffect, type InternalEffect } from "./effects";
import { expireWaitingTask } from "./expiry";
import { outboundBlock, switchRetryAt, type AutomationSwitch } from "./emergency";
import {
  isLeaseStale,
  isTerminalStatus,
  queueEnqueueAt,
  transitionTask,
} from "./tasks";

/**
 * O despachante, sem I/O.
 *
 * `decideDispatch` recebe o ponteiro da Cloud Tasks e o estado lido NA MESMA
 * transacao que vai adquirir a tarefa, e devolve o que gravar. Nada do ponteiro e
 * aceito como verdade alem de qual tarefa e qual tentativa: a Cloud Tasks entrega
 * pelo menos uma vez, entao a mesma entrega duas vezes tem de ser inofensiva.
 *
 * `handoffDispatch` marca a entrega ao executor e `applyDispatchResult` aplica o
 * resultado — juntos em `completeDispatch` quando o provedor responde na hora,
 * separados quando o resultado volta depois pela ponte do n8n (13.3). Todas so
 * mudam o estado por `transitionTask`.
 */

export interface DispatchInput {
  payload: AutomationDispatchPayload;
  task: AutomationTask | null;
  delivery: NotificationDelivery | null;
  organization: Organization | null;
  profession: ProfessionConfig | null;
  appointment: Appointment | null;
  client: Client | null;
  professionalName: string | null;
  /** Remetente do canal, cadastrado pela operadora (13.4). */
  sender: MessagingSender | null;
  /** Chave de emergência da organização e a geral (13.9). */
  switches?: { organization: AutomationSwitch | null; global: AutomationSwitch | null };
  now: ISODateString;
}

export type DispatchStep =
  /** Nada a fazer: tarefa inexistente, concluida, ou ponteiro de outra tentativa. */
  | { kind: "IGNORE"; why: "NOT_FOUND" | "TERMINAL" | "STALE_ATTEMPT" | "AWAITING_RESULT" }
  /** Outra execucao esta com a tarefa. A Cloud Tasks deve tentar mais tarde. */
  | { kind: "BUSY" }
  /** Ainda nao e hora, ou a tentativa corrente ficou sem fila: pedir de novo. */
  | { kind: "REQUEUE"; task: AutomationTask; at: ISODateString }
  | { kind: "STOP"; task: AutomationTask; delivery: NotificationDelivery | null; effects: InternalEffect[] }
  | { kind: "SEND"; task: AutomationTask; delivery: NotificationDelivery; request: SendRequest };

function cancelledDelivery(
  delivery: NotificationDelivery | null,
  at: ISODateString,
): NotificationDelivery | null {
  return delivery
    ? { ...delivery, status: "CANCELLED", cancelledAt: at, nextAttemptAt: null, updatedAt: at, updatedBy: null }
    : null;
}

export function cancel(
  task: AutomationTask,
  delivery: NotificationDelivery | null,
  reason: AutomationStopReason,
  at: ISODateString,
): Extract<DispatchStep, { kind: "STOP" }> {
  const cancelled = transitionTask(task, "CANCELLED", { at, code: reason, patch: { stopReason: reason } });
  return {
    kind: "STOP",
    task: cancelled,
    delivery: cancelledDelivery(delivery, at),
    effects: [auditEffect(cancelled, at)],
  };
}

/**
 * O que vale para todo tipo executado pela Cloud Tasks: tarefa e tentativa
 * certas, execucao em andamento, vencimento, horario e chave de emergencia.
 * `CONTINUE` devolve a tarefa pronta para as travas proprias de cada tipo.
 */
export function guardDispatch(input: {
  payload: AutomationDispatchPayload;
  task: AutomationTask | null;
  delivery: NotificationDelivery | null;
  switches?: DispatchInput["switches"];
  now: ISODateString;
}): Exclude<DispatchStep, { kind: "SEND" }> | { kind: "CONTINUE"; task: AutomationTask } {
  const { payload, task, now } = input;

  if (!task || task.id !== payload.taskId || task.organizationId !== payload.organizationId) {
    return { kind: "IGNORE", why: "NOT_FOUND" };
  }
  if (isTerminalStatus(task.status)) return { kind: "IGNORE", why: "TERMINAL" };

  if (payload.attempt !== task.attempt) {
    // Ponteiro de tentativa anterior. Se a corrente ficou sem fila (o pedido a
    // Cloud Tasks falhou depois de gravar o resultado), e a hora de repor.
    return payload.attempt < task.attempt && task.status === "SCHEDULED"
      ? { kind: "REQUEUE", task, at: queueEnqueueAt(task, now) }
      : { kind: "IGNORE", why: "STALE_ATTEMPT" };
  }

  if (task.status === "DISPATCHING") {
    if (!isLeaseStale(task, now)) return { kind: "BUSY" };
    // A execucao morreu entre adquirir e gravar. Nao se sabe se o envio saiu:
    // falha, alerta e nenhuma tentativa nova.
    const failed = transitionTask(task, "FAILED", {
      at: now,
      code: "DISPATCH_INTERRUPTED",
      patch: { failureCode: "DISPATCH_INTERRUPTED" },
    });
    const delivery = input.delivery
      ? {
          ...input.delivery,
          status: "FAILED" as const,
          failureCode: "DISPATCH_INTERRUPTED" as const,
          nextAttemptAt: null,
          updatedAt: now,
          updatedBy: null,
        }
      : null;
    return { kind: "STOP", task: failed, delivery, effects: [auditEffect(failed, now), alertEffect(failed, now)] };
  }

  if (task.status === "DISPATCHED") return { kind: "IGNORE", why: "AWAITING_RESULT" };

  // Tarefa interna nao passa pela fila: nasce e termina no ato que a origina.
  // Um ponteiro que chegue ate aqui nao executa nada.
  if (AUTOMATION_TASK_META[task.type].executor === "INTERNAL") {
    return cancel(task, input.delivery, "NO_EXECUTOR", now);
  }

  const expired = expireWaitingTask(task, input.delivery, now);
  if (expired) return { kind: "STOP", ...expired };

  if (Date.parse(task.scheduledFor) - DISPATCH_CLOCK_SKEW_SECONDS * 1000 > Date.parse(now)) {
    return { kind: "REQUEUE", task, at: queueEnqueueAt(task, now) };
  }

  // A chave de emergência é conferida aqui, imediatamente antes do envio, e
  // não no planejamento: desligar a chave tem de parar o que já está na fila.
  // A tarefa NÃO é cancelada — fica esperando, e volta sozinha ao religar.
  const blocked = outboundBlock({
    global: input.switches?.global ?? null,
    organization: input.switches?.organization ?? null,
  });
  if (blocked) return { kind: "REQUEUE", task, at: switchRetryAt(now) };

  return { kind: "CONTINUE", task };
}

export function decideDispatch(input: DispatchInput): DispatchStep {
  const guarded = guardDispatch(input);
  if (guarded.kind !== "CONTINUE") return guarded;
  const { task } = guarded;
  const { now } = input;

  if (!input.delivery) return cancel(task, null, "DELIVERY_NOT_FOUND", now);
  if (!input.organization || !input.profession) {
    return cancel(task, input.delivery, "ORGANIZATION_DISABLED", now);
  }

  // As travas de novo, agora, contra o estado atual: consentimento retirado,
  // canal desligado, atendimento cancelado ou remarcado e texto alterado
  // impedem o envio que ja estava planejado.
  const check = recheckBeforeSend({
    organization: input.organization,
    profession: input.profession,
    appointment: input.appointment,
    client: input.client,
    professionalName: input.professionalName,
    delivery: input.delivery,
    plannedForStartsAt: task.appointmentStartsAt,
    sender: input.sender,
  });
  if (!check.ok) return cancel(task, input.delivery, check.reason, now);

  return sendStep(task, input.delivery, input.sender, now, {
    destination: check.destination,
    body: check.body,
    template: check.template,
  });
}

/** Adquire a tarefa e monta o pedido ao provedor. */
function sendStep(
  task: AutomationTask,
  delivery: NotificationDelivery,
  sender: MessagingSender | null,
  now: ISODateString,
  message: Pick<SendRequest, "destination" | "body" | "template" | "freeText">,
): Extract<DispatchStep, { kind: "SEND" }> {
  const scheduled = task.status === "PLANNED" ? transitionTask(task, "SCHEDULED", { at: now }) : task;
  const dispatching = transitionTask(scheduled, "DISPATCHING", { at: now });

  return {
    kind: "SEND",
    task: dispatching,
    delivery: { ...delivery, status: "SENDING", updatedAt: now, updatedBy: null },
    // Destino e texto existem so aqui, na memoria do despachante. Nenhum dos
    // dois e gravado.
    request: {
      deliveryId: delivery.id,
      channel: delivery.channel,
      ...(delivery.channel === "WHATSAPP" && sender?.providerSenderId
        ? { providerSenderId: sender.providerSenderId }
        : {}),
      attempt: task.attempt,
      taskId: task.id,
      organizationId: task.organizationId,
      idempotencyKey: task.idempotencyKey,
      expiresAt: task.expiresAt,
      ...message,
    },
  };
}

// ------------------------------------------------- resposta na conversa

/** O pedido de remarcacao como o despachante precisa dele. */
export interface ReplyOffer {
  status: string;
  appointmentId: string;
  slots: readonly { startsAt: ISODateString; endsAt: ISODateString }[];
  holdEndsAt: ISODateString;
}

export interface ReplyDispatchInput extends DispatchInput {
  /** Conversa atual da pessoa, lida na mesma transacao. */
  conversation: Pick<Conversation, "escalated" | "attention" | "inboundWindowEndsAt"> | null;
  /** Pedido de remarcacao da conversa, lido na mesma transacao. */
  offer: ReplyOffer | null;
}

/**
 * O envio de uma resposta da assistente (etapa 4 da proposta de 24/09).
 *
 * Mesma parte comum de qualquer tarefa (`guardDispatch`) e, no lugar do
 * `recheckBeforeSend` dos avisos, o portão da resposta de novo, contra o estado
 * de AGORA: consentimento, regra, remetente, conversa com gente, janela de 24
 * horas e reserva. O texto é recomposto e só sai se for o mesmo que foi
 * planejado — a oferta com os mesmos horários, a confirmação com o mesmo
 * horário novo.
 */
export function decideReplyDispatch(input: ReplyDispatchInput): DispatchStep {
  const guarded = guardDispatch(input);
  if (guarded.kind !== "CONTINUE") return guarded;
  const { task } = guarded;
  const { now, delivery, appointment, client } = input;

  if (!delivery) return cancel(task, null, "DELIVERY_NOT_FOUND", now);
  if (!input.organization || !input.profession) return cancel(task, delivery, "ORGANIZATION_DISABLED", now);
  const event = task.event;
  if (!event || !isConversationReplyEvent(event) || !task.replyStage) {
    return cancel(task, delivery, "EVENT_WITHOUT_AUTOMATION", now);
  }
  if (!client || client.id !== delivery.clientId) return cancel(task, delivery, "CLIENT_NOT_FOUND", now);
  if (!appointment || appointment.id !== delivery.appointmentId) {
    return cancel(task, delivery, "APPOINTMENT_NOT_FOUND", now);
  }
  // Sem conversa nao ha janela conhecida — e sem janela a Meta nao aceita texto.
  if (!input.conversation) return cancel(task, delivery, "REPLY_WINDOW_CLOSED", now);

  let details: Pick<ReplyContext, "slots" | "startsAt"> = {};
  let validUntil: ISODateString | null = null;
  if (event === "RESCHEDULE_OFFERED") {
    const { offer } = input;
    if (!offer || offer.status !== "OFFERED" || offer.appointmentId !== appointment.id) {
      return cancel(task, delivery, "OFFER_CLOSED", now);
    }
    details = { slots: offer.slots };
    validUntil = offer.holdEndsAt;
  } else if (event === "RESCHEDULE_CONFIRMED") {
    details = { startsAt: appointment.startsAt };
  }

  const decision = evaluateConversationReply({
    organization: input.organization,
    profession: input.profession,
    client,
    sender: input.sender,
    event,
    stage: task.replyStage,
    channel: delivery.channel,
    conversation: input.conversation,
    now,
    validUntil,
    details,
  });
  if (!decision.eligible) return cancel(task, delivery, decision.reason, now);
  if (hashBody(decision.body) !== delivery.bodyHash) return cancel(task, delivery, "BODY_CHANGED", now);

  return sendStep(task, delivery, input.sender, now, {
    destination: decision.destination,
    body: decision.body,
    // Dentro da janela que a pessoa abriu: texto, nao modelo aprovado.
    freeText: true,
  });
}

export interface DispatchCompletion {
  task: AutomationTask;
  delivery: NotificationDelivery;
  effects: InternalEffect[];
  /** Nova tentativa a pedir a Cloud Tasks. `null` quando acabou. */
  requeueAt: ISODateString | null;
}

/**
 * A tarefa saiu das nossas maos: `DISPATCHING` -> `DISPATCHED` (Fase 3, 13.3).
 *
 * Com provedor simulado isso e um instante dentro de `completeDispatch`. Com a
 * ponte do n8n e um estado de espera de verdade: a entrega continua `SENDING`
 * ate o retorno assinado chegar. **Marcar `SENT` aqui seria dizer que o
 * WhatsApp entregou porque o n8n atendeu o telefone.**
 */
export function handoffDispatch(task: AutomationTask, now: ISODateString): AutomationTask {
  return transitionTask(task, "DISPATCHED", { at: now });
}

/**
 * Aplica um resultado a uma tarefa **ja entregue ao executor**. E o mesmo
 * caminho para o resultado sincrono do provedor simulado e para o que volta
 * pelo `automationCallback`: um so lugar decide sucesso, nova tentativa e
 * falha, e um so lugar grava trilha e alerta.
 */
export function applyDispatchResult(input: {
  /** Tarefa em `DISPATCHED`. */
  task: AutomationTask;
  delivery: NotificationDelivery;
  result: AttemptResult;
  now: ISODateString;
}): DispatchCompletion {
  const { task: dispatched, delivery, result, now } = input;
  const outcome = applyAttempt(delivery, result, now);
  const nextDelivery: NotificationDelivery = { ...delivery, ...outcome, updatedAt: now, updatedBy: null };

  if (outcome.status === "SENT") {
    const done = transitionTask(dispatched, "SUCCEEDED", {
      at: now,
      patch: { providerMessageId: result.providerMessageId, failureCode: null },
    });
    return { task: done, delivery: nextDelivery, effects: [auditEffect(done, now)], requeueAt: null };
  }

  if (outcome.status === "PLANNED" && outcome.nextAttemptAt) {
    const retry = transitionTask(dispatched, "SCHEDULED", {
      at: now,
      code: outcome.failureCode,
      patch: { attempt: dispatched.attempt + 1, scheduledFor: outcome.nextAttemptAt, failureCode: outcome.failureCode },
    });
    return {
      task: retry,
      delivery: nextDelivery,
      effects: [auditEffect(retry, now)],
      requeueAt: queueEnqueueAt(retry, now),
    };
  }

  const failed = transitionTask(dispatched, "FAILED", {
    at: now,
    code: outcome.failureCode,
    patch: { failureCode: outcome.failureCode },
  });
  return {
    task: failed,
    delivery: nextDelivery,
    effects: [auditEffect(failed, now), alertEffect(failed, now)],
    requeueAt: null,
  };
}

/**
 * Provedor sincrono: entrega e resultado no mesmo ato. Continua sendo o caminho
 * do simulado e de qualquer provedor que responda na hora.
 */
export function completeDispatch(input: {
  task: AutomationTask;
  delivery: NotificationDelivery;
  result: AttemptResult;
  now: ISODateString;
}): DispatchCompletion {
  return applyDispatchResult({ ...input, task: handoffDispatch(input.task, input.now) });
}
