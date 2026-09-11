import { describe, expect, it } from "vitest";

import {
  APPEND_ONLY_PROTECTED_FIELDS,
  MASKED_CONTACT,
  PERSONAL_DATA_MAP,
  PSEUDONYM_PREFIX,
  REDACTED_NAME,
  REDACTED_TEXT,
} from "@/config/privacy";
import type { PrivacyRedactionMark } from "@/types";

import {
  applyRedactionPatch,
  isPseudonym,
  pseudonymFrom,
  redactionPatch,
  type RedactionContext,
} from "./redaction";

const SUBJECT = "cliente-titular";
const PSEUDONYM = pseudonymFrom("0000-aleatorio");
const MARK: PrivacyRedactionMark = { scope: "CLIENT_ERASURE", requestId: "pedido-1", redactedAt: "2026-09-10T12:00:00.000Z" };
const context: RedactionContext = { mark: MARK, pseudonymOf: (id) => (id === SUBJECT ? PSEUDONYM : null) };

const decision = {
  id: "d1",
  organizationId: "org",
  conversationId: "conv",
  messageId: "m1",
  clientId: SUBJECT,
  professionalId: "prof",
  inputPreview: "Oi, aqui e a Maria, quanto custa?",
  classification: "ADMINISTRATIVE",
  confidence: 0.92,
  appliedRules: [{ ruleId: "r1", ruleName: "Precos", ruleVersion: 2, level: "PROFESSIONAL", outcome: "MATCHED" }],
  action: "AUTO_RESPONSE",
  responseText: "Ola, Maria. A sessao custa R$ 200.",
  reason: 'Pergunta exclusivamente administrativa coberta pela regra "Precos".',
  attention: "NORMAL",
  escalated: false,
  engineVersion: "1.0.0",
  decidedAt: "2026-09-01T10:00:00.000Z",
  latencyMs: 12,
  createdAt: "2026-09-01T10:00:00.000Z",
  createdBy: "prof",
};

function readPath(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => (current as Record<string, unknown> | undefined)?.[key], data);
}

describe("pseudonimizacao", () => {
  it("retira o conteudo da decisao e preserva tudo o que a explica", () => {
    const patch = redactionPatch(PERSONAL_DATA_MAP.aiDecisions.onClientErasure, decision, context)!;
    const after = applyRedactionPatch(decision, patch);

    expect(after).toMatchObject({ clientId: PSEUDONYM, inputPreview: REDACTED_TEXT, responseText: REDACTED_TEXT, privacyRedaction: MARK });
    for (const field of APPEND_ONLY_PROTECTED_FIELDS.aiDecisions) {
      expect(readPath(after, field), field).toEqual(readPath(decision, field));
    }
    expect(JSON.stringify(after)).not.toContain("Maria");
  });

  it("decisao sem resposta continua sem resposta", () => {
    const patch = redactionPatch(PERSONAL_DATA_MAP.aiDecisions.onClientErasure, { ...decision, responseText: null }, context)!;
    expect("responseText" in patch).toBe(false);
  });

  it("na trilha, so o id de cadastro do titular vira pseudonimo", () => {
    const treatment = PERSONAL_DATA_MAP.auditLogs.onClientErasure;
    const entry = (type: string, id: string) => ({
      actorName: "Recepcao",
      summary: "Cadastro de Maria Exemplo criado.",
      resource: { type, id },
      metadata: { status: "ACTIVE" },
    });

    const own = applyRedactionPatch(entry("client", SUBJECT), redactionPatch(treatment, entry("client", SUBJECT), context)!);
    const appointment = applyRedactionPatch(entry("appointment", "ap-1"), redactionPatch(treatment, entry("appointment", "ap-1"), context)!);
    const other = applyRedactionPatch(entry("client", "outro-cliente"), redactionPatch(treatment, entry("client", "outro-cliente"), context)!);

    expect(own).toMatchObject({ summary: REDACTED_TEXT, resource: { type: "client", id: PSEUDONYM }, actorName: "Recepcao", metadata: { status: "ACTIVE" } });
    expect(appointment).toMatchObject({ resource: { type: "appointment", id: "ap-1" } });
    expect(other).toMatchObject({ resource: { type: "client", id: "outro-cliente" } });
  });

  it("na exclusao da organizacao, o nome de quem agiu tambem sai", () => {
    const patch = redactionPatch(PERSONAL_DATA_MAP.auditLogs.onOrganizationDeletion, { actorName: "Recepcao", summary: "x", resource: { type: "rule", id: "r" } }, context)!;
    expect(patch).toMatchObject({ actorName: REDACTED_NAME, summary: REDACTED_TEXT });
  });

  it("mascara o contato e troca o titular do registro de envio", () => {
    const delivery = { clientId: SUBJECT, contactHint: "***0009", status: "SENT", bodyHash: "abcdef12" };
    const after = applyRedactionPatch(delivery, redactionPatch(PERSONAL_DATA_MAP.notificationDeliveries.onClientErasure, delivery, context)!);
    expect(after).toMatchObject({ clientId: PSEUDONYM, contactHint: MASKED_CONTACT, status: "SENT", bodyHash: "abcdef12" });
  });

  it("repetir o mesmo pedido nao gera patch, e outro pedido nao troca o pseudonimo", () => {
    const treatment = PERSONAL_DATA_MAP.aiDecisions.onOrganizationDeletion;
    const once = applyRedactionPatch(decision, redactionPatch(treatment, decision, context)!);
    expect(redactionPatch(treatment, once, context)).toBeNull();

    const later: RedactionContext = {
      mark: { ...MARK, scope: "ORGANIZATION_DELETION", requestId: "pedido-2" },
      pseudonymOf: () => pseudonymFrom("outro"),
    };
    const twice = applyRedactionPatch(once, redactionPatch(treatment, once, later)!);
    expect(twice.clientId).toBe(PSEUDONYM);
    expect(twice.privacyRedaction).toMatchObject({ requestId: "pedido-2" });
  });

  it("apagar, manter ou nao se aplicar nao produz patch", () => {
    expect(redactionPatch({ action: "DELETE" }, decision, context)).toBeNull();
    expect(redactionPatch({ action: "KEEP", why: "motivo escrito o bastante" }, decision, context)).toBeNull();
    expect(redactionPatch({ action: "NOT_APPLICABLE" }, decision, context)).toBeNull();
  });

  it("nenhum tratamento do mapa escreve fora dos campos que declara", () => {
    for (const [collection, policy] of Object.entries(PERSONAL_DATA_MAP)) {
      for (const treatment of [policy.onClientErasure, policy.onOrganizationDeletion]) {
        if (treatment.action !== "PSEUDONYMIZE") continue;
        const sample: Record<string, unknown> = { resource: { type: "client", id: SUBJECT } };
        for (const field of Object.keys(treatment.fields)) if (!field.includes(".")) sample[field] = SUBJECT;
        const patch = redactionPatch(treatment, sample, context)!;
        const allowed = new Set([...Object.keys(treatment.fields), "privacyRedaction"]);
        for (const key of Object.keys(patch)) expect(allowed.has(key), `${collection}: ${key}`).toBe(true);
      }
    }
  });

  it("pseudonimo e reconhecivel e nao contem o id original", () => {
    expect(isPseudonym(PSEUDONYM)).toBe(true);
    expect(PSEUDONYM.startsWith(PSEUDONYM_PREFIX)).toBe(true);
    expect(PSEUDONYM).not.toContain(SUBJECT);
    expect(isPseudonym(SUBJECT)).toBe(false);
  });
});
