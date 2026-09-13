/**
 * Quais campos de cada colecao sao datas.
 *
 * E uma tabela e nao inferencia: adivinhar por nome ("tudo que termina em At")
 * transformaria qualquer campo de texto futuro em data silenciosamente.
 *
 * Fica sem SDK de proposito. O navegador converte com o `Timestamp` do cliente
 * (`converters.ts`) e as functions com o do SDK administrativo
 * (`functions/firestore-dates.js`); a tabela e uma so, entao o que o backend
 * grava e o que a tela le.
 *
 * `externalCalendar.syncedAt` e `gateway` ficam de fora de proposito — sao
 * payloads espelhados de sistemas externos, gravados como vieram. O mesmo vale
 * para `privacyRedaction.redactedAt`, que o backend grava ja em ISO, e para o
 * `history[].at` das tarefas de automacao, que e historico dentro do documento.
 */

const STAMP_FIELDS = ["createdAt", "updatedAt"] as const;

export const COLLECTION_DATE_FIELDS = {
  organizations: STAMP_FIELDS,
  professionals: STAMP_FIELDS,
  members: STAMP_FIELDS,
  clients: [...STAMP_FIELDS, "lastAppointmentAt", "nextAppointmentAt"],
  appointments: [
    ...STAMP_FIELDS,
    "startsAt",
    "endsAt",
    "confirmedAt",
    "cancelledAt",
  ],
  conversations: [...STAMP_FIELDS, "lastMessageAt"],
  messages: [...STAMP_FIELDS, "sentAt", "readAt"],
  transactions: [...STAMP_FIELDS, "dueDate", "paidAt"],
  aiRules: [...STAMP_FIELDS, "lastAppliedAt"],
  aiDecisions: [...STAMP_FIELDS, "decidedAt", "evaluatedAt"],
  notifications: [...STAMP_FIELDS, "acknowledgedAt"],
  notificationDeliveries: [
    ...STAMP_FIELDS,
    "scheduledFor",
    "lastAttemptAt",
    "nextAttemptAt",
    "sentAt",
    "cancelledAt",
  ],
  automationTasks: [
    ...STAMP_FIELDS,
    "scheduledFor",
    "expiresAt",
    "appointmentStartsAt",
    "dispatchingSince",
    "completedAt",
  ],
  auditLogs: [...STAMP_FIELDS, "occurredAt"],
  privacyRequests: [...STAMP_FIELDS, "executedAt"],
} as const;

export type ConvertedCollection = keyof typeof COLLECTION_DATE_FIELDS;
