import { Timestamp } from "firebase/firestore";

import type { ISODateString } from "@/types";

/**
 * Fronteira entre o dominio (strings ISO) e o Firestore (`Timestamp`).
 *
 * Manter a conversao aqui significa que nenhum tipo do dominio importa nada de
 * `firebase/firestore` — o que permite testar regras, motor de decisao e
 * formatacao sem SDK e sem emulador.
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
