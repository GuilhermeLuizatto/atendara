import { Timestamp } from "firebase-admin/firestore";

import { COLLECTION_DATE_FIELDS } from "./generated/date-fields.js";

/**
 * Datas entre o banco (`Timestamp`) e o dominio (ISO), no backend.
 *
 * O navegador converte em `src/lib/firebase/converters.ts` com o SDK cliente;
 * aqui e o SDK administrativo, que tem outro `Timestamp`. A tabela de campos e
 * a mesma (`src/lib/firebase/date-fields.ts`), entao o que as functions gravam
 * e o que a tela le.
 */

function toISO(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

/** Banco -> dominio. O `id` vem do caminho, nunca do corpo do documento. */
export function fromStored(collection, id, data) {
  const result = { ...data, id };
  for (const field of COLLECTION_DATE_FIELDS[collection]) {
    if (field in data) result[field] = toISO(data[field]);
  }
  return result;
}

/** Dominio -> banco. `undefined` sai: o Firestore recusa o valor. */
export function toStored(collection, data) {
  const dates = new Set(COLLECTION_DATE_FIELDS[collection]);
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    result[key] = dates.has(key) && typeof value === "string" ? Timestamp.fromDate(new Date(value)) : value;
  }
  return result;
}
