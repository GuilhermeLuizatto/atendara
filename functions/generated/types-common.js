// Gerado por scripts/build-functions.mjs.
/**
 * Primitivos compartilhados por todos os dominios.
 *
 * Datas trafegam como string ISO-8601 na camada de dominio: sao serializaveis
 * entre Server e Client Components e nao acoplam o dominio ao `Timestamp` do
 * Firestore. A conversao Timestamp <-> ISO acontece na camada de infraestrutura
 * (`src/lib/firebase/converters.ts`).
 */
export function ok(value) {
    return { ok: true, value };
}
export function err(error) {
    return { ok: false, error };
}
