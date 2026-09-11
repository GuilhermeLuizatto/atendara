import {
  MASKED_CONTACT,
  PSEUDONYM_PREFIX,
  REDACTED_NAME,
  REDACTED_TEXT,
  type Replacement,
  type Treatment,
} from "@/config/privacy";
import type { PrivacyRedactionMark } from "@/types/privacy";

/**
 * Pseudonimizacao como funcao pura: documento lido -> patch a gravar.
 *
 * O backend le, chama isto e grava; nada aqui conhece Firestore. O patch usa
 * chave com ponto (`resource.id`), que o SDK administrativo trata como caminho
 * de campo. Transpilado para `functions/generated/privacy-redaction.js`.
 *
 * Repetir e seguro: o mesmo pedido nao gera patch de novo, e um campo que ja
 * carrega pseudonimo nao ganha outro — uma exclusao de organizacao depois de
 * uma eliminacao individual preserva o pseudonimo anterior.
 */

export interface RedactionContext {
  mark: PrivacyRedactionMark;
  /**
   * Pseudonimo de um `clientId`, ou `null` quando aquele id nao e titular desta
   * operacao — e entao o campo fica como esta.
   */
  pseudonymOf(clientId: string): string | null;
}

/** O pseudonimo nao deriva do `clientId`: quem tem o id antigo nao o recalcula. */
export function pseudonymFrom(randomId: string): string {
  return `${PSEUDONYM_PREFIX}${randomId}`;
}

export function isPseudonym(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(PSEUDONYM_PREFIX);
}

function readPath(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (current, key) =>
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[key]
        : undefined,
    data,
  );
}

function pseudonymized(value: unknown, context: RedactionContext): unknown {
  if (typeof value !== "string" || isPseudonym(value)) return value;
  return context.pseudonymOf(value) ?? value;
}

function replace(
  replacement: Replacement,
  value: unknown,
  data: Record<string, unknown>,
  path: string,
  context: RedactionContext,
): unknown {
  switch (replacement) {
    case "CLIENT_ID":
      return pseudonymized(value, context);
    case "CLIENT_RESOURCE_ID": {
      // Na trilha, `resource.id` aponta para atendimento, lancamento, conversa.
      // So o id de cadastro de cliente e do titular.
      const parent = path.split(".").slice(0, -1).join(".");
      return readPath(data, `${parent}.type`) === "client"
        ? pseudonymized(value, context)
        : value;
    }
    case "REDACTED_TEXT":
      return typeof value === "string" ? REDACTED_TEXT : value;
    case "REDACTED_NAME":
      return typeof value === "string" ? REDACTED_NAME : value;
    case "MASKED_CONTACT":
      return typeof value === "string" ? MASKED_CONTACT : value;
    case "NULL":
      return null;
  }
}

/**
 * Patch de pseudonimizacao, ou `null` quando o tratamento nao pseudonimiza ou
 * quando este mesmo pedido ja passou pelo documento. Todo patch leva a marca,
 * inclusive quando nenhum campo mudou: a trilha registra que foi conferida.
 */
export function redactionPatch(
  treatment: Treatment,
  data: Record<string, unknown>,
  context: RedactionContext,
): Record<string, unknown> | null {
  if (treatment.action !== "PSEUDONYMIZE") return null;

  const previous = data.privacyRedaction as PrivacyRedactionMark | null | undefined;
  if (previous?.requestId === context.mark.requestId) return null;

  const patch: Record<string, unknown> = {};
  for (const [path, replacement] of Object.entries(treatment.fields)) {
    const current = readPath(data, path);
    if (current === undefined) continue;
    const next = replace(replacement, current, data, path, context);
    if (next !== current) patch[path] = next;
  }
  patch.privacyRedaction = context.mark;
  return patch;
}

/** O documento como fica depois do patch, com chaves de ponto aninhadas. */
export function applyRedactionPatch(
  data: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(data);
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split(".");
    let target = result;
    for (const key of keys.slice(0, -1)) {
      const next = target[key];
      target[key] = next && typeof next === "object" ? next : {};
      target = target[key] as Record<string, unknown>;
    }
    target[keys[keys.length - 1]] = value;
  }
  return result;
}
