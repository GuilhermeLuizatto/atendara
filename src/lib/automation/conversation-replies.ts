import { CONVERSATION_REPLY_VALIDITY_MINUTES } from "@/config/automation";
import { CHANNEL_META, RETRY_POLICY } from "@/config/notifications";
import { evaluateConversationReply, type ConversationReplyInput } from "@/lib/notifications/eligibility";
import { addMinutes } from "@/lib/notifications/schedule";
import { hashBody } from "@/lib/notifications/templates";
import type {
  Appointment,
  AutomationTask,
  ID,
  ISODateString,
  NotificationDelivery,
  NotificationSkipReason,
} from "@/types";

/**
 * A resposta da assistente, planejada (etapa 3 da proposta de 24/09), sem I/O.
 *
 * Planejar é decidir se a resposta pode sair — pelo mesmo portão da regra 11
 * que o envio confere de novo — e, se pode, montar a entrega e a tarefa que o
 * webhook grava na MESMA transação do pedido ou da escolha. Uma oferta gravada
 * sem a mensagem planejada, ou o contrário, não existe.
 *
 * Como nos avisos, o texto e o destino não são gravados: a entrega guarda a
 * impressão e o tamanho do texto, e o despachante recompõe os dois no envio.
 */

export type ConversationReplyPlan =
  | { kind: "PLANNED"; task: AutomationTask; delivery: NotificationDelivery }
  /**
   * `NO_APPOINTMENT`: pedido sem atendimento futuro. A entrega é sempre de um
   * atendimento; sem ele, o pedido fica só no alerta da equipe.
   */
  | { kind: "SKIPPED"; reason: NotificationSkipReason | "NO_APPOINTMENT" };

/** Uma resposta por mensagem recebida: a reentrega da Meta cai no mesmo id. */
export function conversationReplyId(inboundMessageId: ID): ID {
  return `${inboundMessageId}-resposta`;
}

export function planConversationReply(
  input: ConversationReplyInput & {
    inboundMessageId: ID;
    appointment: Pick<Appointment, "id" | "startsAt" | "professionalId"> | null;
  },
): ConversationReplyPlan {
  if (!input.appointment || !input.client) {
    return { kind: "SKIPPED", reason: input.client ? "NO_APPOINTMENT" : "CLIENT_NOT_IDENTIFIED" };
  }

  const decision = evaluateConversationReply(input);
  if (!decision.eligible) return { kind: "SKIPPED", reason: decision.reason };

  const rule = input.organization.settings.notifications.rules.find(
    (item) => item.event === input.event && item.channel === input.channel,
  );
  // O portão já exigiu a regra; chegar aqui sem ela seria erro de quem chamou.
  if (!rule) return { kind: "SKIPPED", reason: "NO_RULE_FOR_EVENT" };

  const id = conversationReplyId(input.inboundMessageId);
  const at = input.now;
  const expiresAt = replyExpiresAt(input);
  const { appointment, client } = input;

  const delivery: NotificationDelivery = {
    id,
    organizationId: input.organization.id,
    createdAt: at,
    updatedAt: at,
    createdBy: null,
    updatedBy: null,
    audience: "ORGANIZATION_TO_CLIENT",
    event: input.event,
    channel: input.channel,
    ruleId: rule.id,
    appointmentId: appointment.id,
    clientId: client.id,
    professionalId: appointment.professionalId,
    scheduledFor: at,
    status: "PLANNED",
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    providerId: CHANNEL_META[input.channel].providerId,
    providerMessageId: null,
    failureCode: null,
    templateId: `assistant:${input.event}:${input.stage}`,
    bodyHash: hashBody(decision.body),
    bodyLength: decision.body.length,
    contactHint: decision.contactHint,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    cancelledAt: null,
  };

  const task: AutomationTask = {
    id,
    organizationId: input.organization.id,
    createdAt: at,
    updatedAt: at,
    createdBy: null,
    updatedBy: null,
    type: "SEND_CONVERSATION_REPLY",
    status: "PLANNED",
    attempt: 1,
    maxAttempts: RETRY_POLICY.maxAttempts,
    scheduledFor: at,
    expiresAt,
    idempotencyKey: id,
    appointmentId: appointment.id,
    appointmentStartsAt: appointment.startsAt,
    clientId: client.id,
    professionalId: appointment.professionalId,
    deliveryId: id,
    sourceTaskId: null,
    event: input.event,
    channel: input.channel,
    failureCode: null,
    stopReason: null,
    providerMessageId: null,
    dispatchingSince: null,
    completedAt: null,
    history: [{ from: null, to: "PLANNED", at, attempt: 1, code: null }],
    replyStage: input.stage,
  };

  return { kind: "PLANNED", task, delivery };
}

/**
 * A resposta vale pelo menor dos prazos: o dela (reserva da oferta, ou a
 * validade curta das demais) e a janela de 24 horas que a pessoa abriu.
 */
function replyExpiresAt(input: ConversationReplyInput): ISODateString {
  const own = input.validUntil ?? addMinutes(input.now, CONVERSATION_REPLY_VALIDITY_MINUTES);
  const window = input.conversation.inboundWindowEndsAt;
  const limits = [Date.parse(own), ...(window ? [Date.parse(window)] : [])];
  return new Date(Math.min(...limits)).toISOString();
}
