/**
 * Primitivos compartilhados por todos os dominios.
 *
 * Datas trafegam como string ISO-8601 na camada de dominio: sao serializaveis
 * entre Server e Client Components e nao acoplam o dominio ao `Timestamp` do
 * Firestore. A conversao Timestamp <-> ISO acontece na camada de infraestrutura
 * (`src/lib/firebase/converters.ts`).
 */

export type ID = string;

/** String ISO-8601, ex.: "2026-09-09T14:30:00.000Z". */
export type ISODateString = string;

export type CurrencyCode = "BRL";

/**
 * Valores monetarios sao sempre inteiros em centavos. Nenhum ponto flutuante
 * atravessa a camada financeira.
 */
export interface Money {
  amountInCents: number;
  currency: CurrencyCode;
}

export interface AuditStamp {
  createdAt: ISODateString;
  updatedAt: ISODateString;
  createdBy: ID | null;
  updatedBy: ID | null;
}

export interface BaseEntity extends AuditStamp {
  id: ID;
}

/**
 * Toda entidade que vive sob `organizations/{organizationId}` repete o
 * `organizationId` no proprio documento. E redundante em relacao ao caminho,
 * mas permite `collectionGroup` queries com filtro de tenant e serve como
 * verificacao adicional nas Security Rules (defense in depth).
 */
export interface TenantScopedEntity extends BaseEntity {
  organizationId: ID;
}

export type Result<T, E = string> =
  { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Faixa de datas usada por agenda e relatorios financeiros. */
export interface DateRange {
  start: ISODateString;
  end: ISODateString;
}
