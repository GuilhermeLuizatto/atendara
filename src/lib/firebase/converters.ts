import { Timestamp } from "firebase/firestore";

import type { ISODateString } from "@/types";

import { COLLECTION_DATE_FIELDS, type ConvertedCollection } from "./date-fields";

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

// A tabela mora sem SDK em `date-fields.ts`: as functions convertem com ela.
export { COLLECTION_DATE_FIELDS, type ConvertedCollection };

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
