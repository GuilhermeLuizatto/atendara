import {
  AUTOMATION_CONTRACT_VERSION,
  AUTOMATION_TASK_META,
  AUTOMATION_TRANSITIONS,
  DISPATCH_LEASE_SECONDS,
  INTERNAL_TASK_VALIDITY_MINUTES,
  QUEUE_MAX_DELAY_DAYS,
  TERMINAL_AUTOMATION_STATUSES,
  WAITING_AUTOMATION_STATUSES,
} from "@/config/automation";
import { MAX_DELIVERY_DELAY_MINUTES, RETRY_POLICY } from "@/config/notifications";
import type { PlannedDelivery } from "@/lib/notifications/planner";
import { addMinutes } from "@/lib/notifications/schedule";
import { hashBody } from "@/lib/notifications/templates";
import type {
  AutomationDispatchPayload,
  AutomationTask,
  AutomationTaskStatus,
  AutomationTaskType,
  ID,
  ISODateString,
} from "@/types";

/**
 * Tarefa de automacao: identidade, validade e mudanca de estado.
 *
 * Funcoes puras. Toda mudanca de estado passa por `transitionTask`, que recusa o
 * que `AUTOMATION_TRANSITIONS` nao lista — inclusive sair de estado terminal — e
 * acrescenta o passo ao historico da propria tarefa.
 */

export class AutomationTransitionError extends Error {
  constructor(task: Pick<AutomationTask, "id" | "type" | "status">, to: AutomationTaskStatus) {
    super(`Transição recusada na tarefa ${task.id} (${task.type}): ${task.status} -> ${to}.`);
    this.name = "AutomationTransitionError";
  }
}

export function isTerminalStatus(status: AutomationTaskStatus): boolean {
  return TERMINAL_AUTOMATION_STATUSES.includes(status);
}

export function isWaitingStatus(status: AutomationTaskStatus): boolean {
  return WAITING_AUTOMATION_STATUSES.includes(status);
}

export function canTransition(
  type: AutomationTaskType,
  from: AutomationTaskStatus,
  to: AutomationTaskStatus,
): boolean {
  const executor = AUTOMATION_TASK_META[type].executor;
  return AUTOMATION_TRANSITIONS.some(
    (rule) => rule.from === from && rule.to === to && rule.executors.includes(executor),
  );
}

export interface TransitionOptions {
  at: ISODateString;
  /** Motivo nomeado ou codigo de falha registrado no passo. */
  code?: string | null;
  patch?: Partial<
    Pick<AutomationTask, "attempt" | "scheduledFor" | "failureCode" | "stopReason" | "providerMessageId">
  >;
}

export function transitionTask(
  task: AutomationTask,
  to: AutomationTaskStatus,
  options: TransitionOptions,
): AutomationTask {
  if (!canTransition(task.type, task.status, to)) {
    throw new AutomationTransitionError(task, to);
  }

  const patch = options.patch ?? {};
  const attempt = patch.attempt ?? task.attempt;
  // A tentativa so avanca na volta de uma falha retentavel, uma por vez e ate o
  // limite. Qualquer outro salto seria reenvio sem registro.
  const retrying = task.status === "DISPATCHED" && to === "SCHEDULED";
  if (retrying ? attempt !== task.attempt + 1 || attempt > task.maxAttempts : attempt !== task.attempt) {
    throw new AutomationTransitionError(task, to);
  }

  return {
    ...task,
    ...patch,
    status: to,
    updatedAt: options.at,
    dispatchingSince: to === "DISPATCHING" ? options.at : null,
    completedAt: isTerminalStatus(to) ? options.at : null,
    history: [
      ...task.history,
      { from: task.status, to, at: options.at, attempt, code: options.code ?? null },
    ],
  };
}

// --------------------------------------------------------------- validade

/**
 * Validade de um aviso: o horario planejado mais `MAX_DELIVERY_DELAY_MINUTES`,
 * e nunca depois do inicio do atendimento — lembrete que chega com o atendimento
 * em curso nao lembra nada.
 */
export function noticeExpiresAt(
  scheduledFor: ISODateString,
  appointmentStartsAt: ISODateString,
): ISODateString {
  const latest = Date.parse(addMinutes(scheduledFor, MAX_DELIVERY_DELAY_MINUTES));
  return new Date(Math.min(latest, Date.parse(appointmentStartsAt))).toISOString();
}

export function isTaskExpired(task: Pick<AutomationTask, "expiresAt">, now: ISODateString): boolean {
  return Date.parse(now) >= Date.parse(task.expiresAt);
}

/** A execucao em andamento passou do prazo sem gravar resultado. */
export function isLeaseStale(
  task: Pick<AutomationTask, "dispatchingSince">,
  now: ISODateString,
): boolean {
  if (!task.dispatchingSince) return true;
  return Date.parse(now) - Date.parse(task.dispatchingSince) > DISPATCH_LEASE_SECONDS * 1000;
}

// ------------------------------------------------------------- identidade

/**
 * Id do aviso na fila.
 *
 * E o `deliveryKey` (ADR 0003): replanejar o mesmo aviso cai no mesmo documento.
 * Estado terminal nao volta, entao remarcar de volta para um horario cujo aviso
 * ja foi cancelado ganha sufixo `_2`, `_3` — continua deterministico, porque so
 * depende do que ja existe na fila.
 */
export function noticeTaskId(key: string, existing: readonly Pick<AutomationTask, "id">[]): ID {
  const used = new Set(existing.map((task) => task.id));
  if (!used.has(key)) return key;
  let suffix = 2;
  while (used.has(`${key}_${suffix}`)) suffix += 1;
  return `${key}_${suffix}`;
}

/**
 * Chaves que impedem planejar de novo: tudo o que nao foi cancelado nem venceu.
 * Um aviso ja enviado bloqueia — reentregar o gatilho nao manda outro.
 */
export function blockingNoticeKeys(tasks: readonly AutomationTask[]): string[] {
  return tasks
    .filter((task) => task.deliveryId !== null && task.status !== "CANCELLED" && task.status !== "EXPIRED")
    .map((task) => task.idempotencyKey);
}

export function newNoticeTask(input: {
  id: ID;
  type: AutomationTaskType;
  organizationId: ID;
  planned: PlannedDelivery;
  appointmentStartsAt: ISODateString;
  at: ISODateString;
}): AutomationTask {
  const { id, planned, at } = input;
  return {
    id,
    organizationId: input.organizationId,
    createdAt: at,
    updatedAt: at,
    createdBy: null,
    updatedBy: null,
    type: input.type,
    status: "PLANNED",
    attempt: 1,
    maxAttempts: RETRY_POLICY.maxAttempts,
    scheduledFor: planned.scheduledFor,
    expiresAt: noticeExpiresAt(planned.scheduledFor, input.appointmentStartsAt),
    idempotencyKey: planned.id,
    appointmentId: planned.appointmentId,
    appointmentStartsAt: input.appointmentStartsAt,
    clientId: planned.clientId,
    professionalId: planned.professionalId,
    deliveryId: id,
    sourceTaskId: null,
    event: planned.event,
    channel: planned.channel,
    failureCode: null,
    stopReason: null,
    providerMessageId: null,
    dispatchingSince: null,
    completedAt: null,
    history: [{ from: null, to: "PLANNED", at, attempt: 1, code: null }],
  };
}

/**
 * Tarefa interna nascida de uma mudanca de estado de outra. O id deriva da
 * origem e do passo do historico que a gerou: o mesmo passo nunca gera dois
 * alertas nem duas entradas na trilha.
 */
export function newInternalTask(
  type: AutomationTaskType,
  source: AutomationTask,
  at: ISODateString,
): AutomationTask {
  if (AUTOMATION_TASK_META[type].executor !== "INTERNAL") {
    throw new Error(`O tipo ${type} não é interno.`);
  }
  const id = `${source.id}_${type}_${source.history.length}`;
  return {
    id,
    organizationId: source.organizationId,
    createdAt: at,
    updatedAt: at,
    createdBy: null,
    updatedBy: null,
    type,
    status: "PLANNED",
    attempt: 1,
    maxAttempts: 1,
    scheduledFor: at,
    expiresAt: addMinutes(at, INTERNAL_TASK_VALIDITY_MINUTES),
    idempotencyKey: id,
    appointmentId: source.appointmentId,
    appointmentStartsAt: source.appointmentStartsAt,
    clientId: source.clientId,
    professionalId: source.professionalId,
    deliveryId: null,
    sourceTaskId: source.id,
    event: source.event,
    channel: source.channel,
    failureCode: null,
    stopReason: null,
    providerMessageId: null,
    dispatchingSince: null,
    completedAt: null,
    history: [{ from: null, to: "PLANNED", at, attempt: 1, code: null }],
  };
}

// ------------------------------------------------------------------- fila

/**
 * Quando pedir a Cloud Tasks: o horario da tarefa, sem passar do limite da fila.
 * Alem do limite, o despertar e arredondado ao dia: duas entregas do mesmo
 * planejamento no mesmo dia pedem o mesmo nome, e a fila fica com um so.
 */
export function queueEnqueueAt(
  task: Pick<AutomationTask, "scheduledFor">,
  now: ISODateString,
): ISODateString {
  const day = 86_400_000;
  const nowMs = Date.parse(now);
  const horizon = Math.floor((nowMs + QUEUE_MAX_DELAY_DAYS * day) / day) * day;
  return new Date(Math.max(nowMs, Math.min(Date.parse(task.scheduledFor), horizon))).toISOString();
}

/**
 * Nome da tarefa na Cloud Tasks. A fila recusa nome repetido, e e isso que torna
 * inofensivo reentregar o planejamento ou o resultado. O prefixo de hash espalha
 * os nomes, como a Cloud Tasks recomenda.
 */
export function queueTaskName(
  task: Pick<AutomationTask, "id" | "organizationId" | "attempt">,
  enqueueAt: ISODateString,
): string {
  const base = `${task.organizationId}_${task.id}_a${task.attempt}_${Date.parse(enqueueAt)}`.replace(
    /[^A-Za-z0-9_-]/g,
    "-",
  );
  return `${hashBody(base)}-${base}`.slice(0, 500);
}

export function dispatchPayloadFor(
  task: Pick<AutomationTask, "id" | "organizationId" | "attempt">,
): AutomationDispatchPayload {
  return {
    version: AUTOMATION_CONTRACT_VERSION,
    organizationId: task.organizationId,
    taskId: task.id,
    attempt: task.attempt,
  };
}
