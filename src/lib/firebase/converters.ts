import { Timestamp } from "firebase/firestore";

import type { ISODateString } from "@/types";

/**
 * Fronteira entre o dominio (strings ISO) e o Firestore (`Timestamp`).
 *
 * Manter a conversao aqui significa que nenhum tipo do dominio importa nada de
 * `firebase/firestore` — o que permite testar regras, motor de decisao e
 * formatacao sem SDK e sem emulador.
 *
 * As datas sao gravadas como `Timestamp` (e nao como string) porque e o tipo
 * que o Firestore ordena, indexa e exporta nativamente: politicas de TTL,
 * comparacao com `request.time` nas Security Rules e leitura no console
 * dependem disso. O dominio nunca ve esse tipo.
 */

export function toISO(value: unknown): ISODateString | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

export function toTimestamp(iso: ISODateString | null): Timestamp | null {
  return iso ? Timestamp.fromDate(new Date(iso)) : null;
}

/** Converte, em profundidade rasa, os campos de data conhecidos de um doc. */
export function mapTimestamps<T extends Record<string, unknown>>(
  data: T,
  dateFields: readonly (keyof T)[],
): T {
  const result = { ...data };
  for (const field of dateFields) {
    result[field] = toISO(data[field]) as T[keyof T];
  }
  return result;
}

// ------------------------------------------------- registro por colecao

const STAMP_FIELDS = ["createdAt", "updatedAt"] as const;

/**
 * Quais campos de cada colecao sao datas.
 *
 * E uma tabela e nao inferencia: adivinhar por nome ("tudo que termina em At")
 * transformaria qualquer campo de texto futuro em data silenciosamente.
 *
 * `externalCalendar.syncedAt` e `gateway` ficam de fora de proposito — sao
 * payloads espelhados de sistemas externos, gravados como vieram. O mesmo vale
 * para `privacyRedaction.redactedAt`, que o backend grava ja em ISO.
 */
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
  auditLogs: [...STAMP_FIELDS, "occurredAt"],
  privacyRequests: [...STAMP_FIELDS, "executedAt"],
} as const;

export type ConvertedCollection = keyof typeof COLLECTION_DATE_FIELDS;

/**
 * Dominio -> Firestore. Datas viram `Timestamp`; `undefined` e removido porque
 * o Firestore recusa o valor, enquanto `null` e legitimo ("sem valor").
 */
export function toFirestoreData(
  collection: ConvertedCollection,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const dateFields = new Set<string>(COLLECTION_DATE_FIELDS[collection]);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    result[key] =
      dateFields.has(key) && (typeof value === "string" || value === null)
        ? toTimestamp(value as ISODateString | null)
        : value;
  }

  return result;
}

/** Firestore -> dominio. O `id` vem do caminho, nunca do corpo do documento. */
export function fromFirestoreData<T>(
  collection: ConvertedCollection,
  id: string,
  data: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...data, id };
  for (const field of COLLECTION_DATE_FIELDS[collection]) {
    if (field in data) result[field] = toISO(data[field as keyof typeof data]);
  }
  return result as T;
}
