import { CALENDAR_SYNC_VALIDITY_MINUTES } from "@/config/automation";
import { GOOGLE_CALENDAR_WRITE_SCOPE } from "@/config/calendar";
import { RETRY_POLICY, isRetriable } from "@/config/notifications";
import { calendarEventFor, type CalendarEvent } from "@/lib/agenda/calendar";
import { addMinutes } from "@/lib/notifications/schedule";
import type {
  Appointment,
  AutomationDispatchPayload,
  AutomationTask,
  DeliveryFailureCode,
  ID,
  ISODateString,
  Organization,
  ProfessionConfig,
} from "@/types";

import { cancel, guardDispatch, type DispatchInput, type DispatchStep } from "./dispatch";
import { alertEffect, auditEffect, type InternalEffect } from "./effects";
import { isWaitingStatus, noticeTaskId, queueEnqueueAt, transitionTask } from "./tasks";

/**
 * Atendimento do Atendara refletido na agenda "Atendara" do Google (3C).
 *
 * A tarefa nao carrega "criar" nem "apagar": diz "acerte o Google deste
 * atendimento para este profissional". Quem decide o que fazer e o despachante,
 * contra o atendimento como esta NA HORA. Assim uma escrita atrasada nunca
 * ressuscita um atendimento cancelado, e repetir a tarefa e inofensivo — o
 * evento tem id derivado do atendimento.
 *
 * O que o evento diz sai de `calendarEventFor`, pelo grau de exposicao da
 * profissao. Nada aqui importa `firebase/*`.
 */

/** O que o planejamento e o despacho precisam da conexao — nunca o token. */
export interface CalendarWriteConnection {
  status: "CONNECTED" | "REVOKED" | "ERROR";
  scopes: readonly string[];
  calendarId: string | null;
  generation: string | null;
}

/** Conectada, com permissao de escrita e com a agenda "Atendara" criada. */
export function canWriteCalendar(connection: CalendarWriteConnection | null): boolean {
  return (
    connection?.status === "CONNECTED" &&
    connection.scopes.includes(GOOGLE_CALENDAR_WRITE_SCOPE) &&
    !!connection.calendarId &&
    !!connection.generation
  );
}

const INACTIVE = new Set(["CANCELLED", "NO_SHOW"]);

/** O atendimento deve existir na agenda Google DESTE profissional? */
export function belongsInCalendar(appointment: Appointment | null, professionalId: ID): appointment is Appointment {
  return !!appointment && appointment.professionalId === professionalId && !INACTIVE.has(appointment.status);
}

/**
 * O que, no atendimento, muda o evento no Google. Editar uma observacao nao
 * gera tarefa; mudar horario, situacao, quem atende ou o nome, sim.
 */
export function calendarFingerprint(appointment: Appointment | null, professionalId: ID): string {
  if (!belongsInCalendar(appointment, professionalId)) return "ABSENT";
  return JSON.stringify([appointment.startsAt, appointment.endsAt, appointment.clientName]);
}

const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

/**
 * Id do evento no Google: os bytes do id do atendimento em base32hex, o
 * alfabeto que a API aceita. Sem hash, entao sem colisao; e o mesmo em toda
 * repeticao, entao duas execucoes nunca criam dois eventos.
 */
export function calendarEventId(appointmentId: ID): string {
  const bytes = new TextEncoder().encode(appointmentId);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return out;
}

export function calendarSyncKey(appointmentId: ID, professionalId: ID): string {
  return `calendar_${appointmentId}_${professionalId}`;
}

export function newCalendarSyncTask(input: {
  id: ID;
  organizationId: ID;
  appointmentId: ID;
  professionalId: ID;
  appointmentStartsAt: ISODateString | null;
  at: ISODateString;
}): AutomationTask {
  const { id, at } = input;
  return {
    id,
    organizationId: input.organizationId,
    createdAt: at,
    updatedAt: at,
    createdBy: null,
    updatedBy: null,
    type: "SYNC_CALENDAR_EVENT",
    status: "PLANNED",
    attempt: 1,
    maxAttempts: RETRY_POLICY.maxAttempts,
    scheduledFor: at,
    expiresAt: addMinutes(at, CALENDAR_SYNC_VALIDITY_MINUTES),
    idempotencyKey: calendarSyncKey(input.appointmentId, input.professionalId),
    appointmentId: input.appointmentId,
    appointmentStartsAt: input.appointmentStartsAt,
    // Nenhum dado de quem e atendido: a tarefa aponta o atendimento e mais nada.
    clientId: null,
    professionalId: input.professionalId,
    deliveryId: null,
    sourceTaskId: null,
    event: null,
    channel: null,
    failureCode: null,
    stopReason: null,
    providerMessageId: null,
    dispatchingSince: null,
    completedAt: null,
    history: [{ from: null, to: "PLANNED", at, attempt: 1, code: null }],
  };
}

/**
 * Tarefas de agenda para um atendimento, a partir de uma escrita.
 *
 * Sincroniza quem atendia antes e quem atende depois: trocar de profissional
 * apaga de uma agenda e cria na outra. Nao cria nada quando ja ha uma tarefa
 * esperando — ela lera o estado atual quando executar.
 */
export function planCalendarSync(input: {
  organizationId: ID;
  appointmentId: ID;
  before: Appointment | null;
  after: Appointment | null;
  /** Conexao de cada profissional envolvido; ausente vale como desconectado. */
  connections: Readonly<Record<ID, CalendarWriteConnection | null>>;
  /** Tarefas ja existentes deste atendimento, de qualquer tipo. */
  tasks: readonly AutomationTask[];
  at: ISODateString;
}): AutomationTask[] {
  const professionals = [...new Set([input.before?.professionalId, input.after?.professionalId])].filter(
    (id): id is ID => !!id,
  );
  const created: AutomationTask[] = [];
  const known = [...input.tasks];

  for (const professionalId of professionals) {
    if (!canWriteCalendar(input.connections[professionalId] ?? null)) continue;
    if (
      calendarFingerprint(input.before, professionalId) === calendarFingerprint(input.after, professionalId)
    ) {
      continue;
    }
    const key = calendarSyncKey(input.appointmentId, professionalId);
    const waiting = known.some(
      (task) => task.type === "SYNC_CALENDAR_EVENT" && task.idempotencyKey === key && isWaitingStatus(task.status),
    );
    if (waiting) continue;

    const task = newCalendarSyncTask({
      id: noticeTaskId(key, known),
      organizationId: input.organizationId,
      appointmentId: input.appointmentId,
      professionalId,
      appointmentStartsAt: input.after?.startsAt ?? input.before?.startsAt ?? null,
      at: input.at,
    });
    created.push(task);
    known.push(task);
  }
  return created;
}

/**
 * Ao conectar: os atendimentos ativos de hoje em diante vao para o Google.
 * Cada um ganha sua tarefa; os que ja tem tarefa esperando ficam com ela.
 */
export function planCalendarBackfill(input: {
  organizationId: ID;
  professionalId: ID;
  appointments: readonly Appointment[];
  /** Tarefas de agenda deste profissional ainda esperando. */
  waiting: readonly AutomationTask[];
  at: ISODateString;
}): AutomationTask[] {
  const pending = new Set(input.waiting.map((task) => task.idempotencyKey));
  const created: AutomationTask[] = [];
  for (const appointment of input.appointments) {
    if (!belongsInCalendar(appointment, input.professionalId)) continue;
    const key = calendarSyncKey(appointment.id, input.professionalId);
    if (pending.has(key)) continue;
    const task = newCalendarSyncTask({
      // A hora entra no id: o mesmo atendimento pode ter tarefas terminadas de
      // uma conexao anterior, e esta nao pode colidir com elas.
      id: `${key}_${Date.parse(input.at)}`,
      organizationId: input.organizationId,
      appointmentId: appointment.id,
      professionalId: input.professionalId,
      appointmentStartsAt: appointment.startsAt,
      at: input.at,
    });
    created.push(task);
    pending.add(key);
  }
  return created;
}

// ------------------------------------------------------------ despacho

export interface CalendarDispatchInput {
  payload: AutomationDispatchPayload;
  task: AutomationTask | null;
  organization: Organization | null;
  profession: ProfessionConfig | null;
  appointment: Appointment | null;
  connection: CalendarWriteConnection | null;
  /** Quem atende ainda e profissional ativo, ligado a conta dona da conexao. */
  ownerLinked: boolean;
  switches?: DispatchInput["switches"];
  now: ISODateString;
}

export type CalendarDispatchStep =
  | Exclude<DispatchStep, { kind: "SEND" }>
  | {
      kind: "SYNC";
      task: AutomationTask;
      calendarId: string;
      /** A execucao so grava de volta se a conexao ainda for esta. */
      generation: string;
      eventId: string;
      /** `null` quer dizer apagar. */
      event: CalendarEvent | null;
      /** Para saber, ao terminar, se o atendimento mudou no meio. */
      fingerprint: string;
    };

export function decideCalendarDispatch(input: CalendarDispatchInput): CalendarDispatchStep {
  const guarded = guardDispatch({ ...input, delivery: null });
  if (guarded.kind !== "CONTINUE") return guarded;
  const { task } = guarded;
  const { now } = input;

  if (!task.appointmentId || !task.professionalId) return cancel(task, null, "APPOINTMENT_NOT_FOUND", now);
  if (!input.organization || !input.profession) return cancel(task, null, "ORGANIZATION_DISABLED", now);
  if (!input.ownerLinked || !canWriteCalendar(input.connection)) {
    return cancel(task, null, "CALENDAR_NOT_CONNECTED", now);
  }

  const appointment = input.appointment;
  const event = belongsInCalendar(appointment, task.professionalId)
    ? calendarEventFor({
        appointment,
        serviceTerm: input.profession.terminology.appointment.singularLower,
        disclosure: input.profession.notifications.disclosure,
      })
    : null;

  const scheduled = task.status === "PLANNED" ? transitionTask(task, "SCHEDULED", { at: now }) : task;
  return {
    kind: "SYNC",
    task: transitionTask(scheduled, "DISPATCHING", { at: now }),
    // `canWriteCalendar` garantiu os dois.
    calendarId: input.connection!.calendarId!,
    generation: input.connection!.generation!,
    eventId: calendarEventId(task.appointmentId),
    event,
    fingerprint: calendarFingerprint(appointment, task.professionalId),
  };
}

export type CalendarSyncResult =
  | { outcome: "SYNCED" }
  | { outcome: "TEMPORARY_FAILURE"; failureCode: DeliveryFailureCode }
  | { outcome: "PERMANENT_FAILURE"; failureCode: DeliveryFailureCode };

export interface CalendarSyncCompletion {
  task: AutomationTask;
  effects: InternalEffect[];
  requeueAt: ISODateString | null;
}

/** Resultado do Google aplicado a tarefa em `DISPATCHING`, sempre por `transitionTask`. */
export function applyCalendarResult(input: {
  task: AutomationTask;
  result: CalendarSyncResult;
  now: ISODateString;
}): CalendarSyncCompletion {
  const { result, now } = input;
  const dispatched = transitionTask(input.task, "DISPATCHED", { at: now });

  if (result.outcome === "SYNCED") {
    const done = transitionTask(dispatched, "SUCCEEDED", { at: now, patch: { failureCode: null } });
    return { task: done, effects: [auditEffect(done, now)], requeueAt: null };
  }

  const { failureCode } = result;
  if (
    result.outcome === "TEMPORARY_FAILURE" &&
    isRetriable(failureCode) &&
    dispatched.attempt < dispatched.maxAttempts
  ) {
    const wait =
      RETRY_POLICY.backoffMinutes[dispatched.attempt - 1] ??
      RETRY_POLICY.backoffMinutes[RETRY_POLICY.backoffMinutes.length - 1];
    const retry = transitionTask(dispatched, "SCHEDULED", {
      at: now,
      code: failureCode,
      patch: { attempt: dispatched.attempt + 1, scheduledFor: addMinutes(now, wait), failureCode },
    });
    return { task: retry, effects: [auditEffect(retry, now)], requeueAt: queueEnqueueAt(retry, now) };
  }

  const code: DeliveryFailureCode =
    result.outcome === "TEMPORARY_FAILURE" && isRetriable(failureCode) ? "ATTEMPTS_EXHAUSTED" : failureCode;
  const failed = transitionTask(dispatched, "FAILED", { at: now, code, patch: { failureCode: code } });
  return { task: failed, effects: [auditEffect(failed, now), alertEffect(failed, now)], requeueAt: null };
}
