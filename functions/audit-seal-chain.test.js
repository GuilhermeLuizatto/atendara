import { describe, expect, it } from "vitest";

import {
  SEALED_ENTRY_FIELDS,
  canonical,
  entryDigest,
  nextSeal,
  sealDigest,
  verifyAuditSealChain,
} from "./audit-seal-chain.js";

/**
 * O selo da trilha, so calculo. Aqui se fixa o que a corrente detecta — e o que
 * ela NAO detecta, que e tao importante: entrada inventada em nome proprio e
 * alteracao dos campos que a pseudonimizacao pode trocar.
 */

const WRITTEN_AT = "2026-11-17T12:00:00.000Z";

const entryOf = (patch = {}) => ({
  id: "log-1",
  organizationId: "org-a",
  actorType: "USER",
  actorId: "membro-1",
  actorName: "Quem registrou",
  action: "CREATE",
  summary: "Cadastro de Maria criado.",
  resource: { type: "client", id: "cliente-1" },
  metadata: { module: "clientes" },
  occurredAt: WRITTEN_AT,
  createdAt: WRITTEN_AT,
  createdBy: "membro-1",
  updatedBy: "membro-1",
  ...patch,
});

/** Uma corrente pronta, como o gatilho a produziria. */
function chainOf(count) {
  const seals = [];
  const entries = [];
  let previous = null;
  for (let position = 1; position <= count; position += 1) {
    const logId = `log-${position}`;
    const entry = entryOf({ id: logId, summary: `Entrada ${position}.` });
    const writtenAt = new Date(Date.parse(WRITTEN_AT) + position * 1000).toISOString();
    const seal = nextSeal({ logId, entry, writtenAt, previous });
    previous = { index: seal.index, sealHash: seal.sealHash };
    seals.push(seal);
    entries.push(entry);
  }
  return { seals, entries };
}

describe("serializacao canonica", () => {
  it("nao depende da ordem das chaves", () => {
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }));
  });

  it("le `Timestamp` e `Date` como o mesmo instante", () => {
    const at = new Date(WRITTEN_AT);
    expect(canonical({ at })).toBe(canonical({ at: { toDate: () => at } }));
    expect(canonical(at)).toBe(JSON.stringify(WRITTEN_AT));
  });

  it("trata campo ausente e campo `undefined` igual", () => {
    expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1 }));
  });

  // Ordem por codigo de caractere: `localeCompare` mudaria com o idioma de quem
  // roda, e o resumo da mesma entrada deixaria de ser o mesmo.
  it("ordena por codigo de caractere, nao pela ordem do idioma", () => {
    expect(canonical({ a: 1, B: 2, á: 3 })).toBe('{"B":2,"a":1,"á":3}');
  });

  it("recusa valor que nao sabe serializar em vez de inventar um resumo", () => {
    expect(canonical(() => 1)).toBe("null");
    expect(canonical(Number.NaN)).toBe("null");
    expect(canonical([1, "dois", true, null])).toBe('[1,"dois",true,null]');
  });
});

describe("resumo da entrada", () => {
  it("cobre so os campos que ninguem pode mudar", () => {
    expect([...SEALED_ENTRY_FIELDS]).toEqual([
      "organizationId",
      "actorType",
      "actorId",
      "action",
      "resource.type",
      "metadata",
      "occurredAt",
      "createdAt",
      "createdBy",
    ]);
  });

  it("muda quando um campo protegido muda", () => {
    const base = entryDigest({ logId: "log-1", entry: entryOf(), writtenAt: WRITTEN_AT });
    for (const patch of [
      { action: "DELETE" },
      { actorId: "outro-membro" },
      { resource: { type: "transaction", id: "cliente-1" } },
      { metadata: { module: "financeiro" } },
      { occurredAt: "2026-11-16T12:00:00.000Z" },
    ]) {
      expect(entryDigest({ logId: "log-1", entry: entryOf(patch), writtenAt: WRITTEN_AT })).not.toBe(base);
    }
  });

  it("muda quando o id ou o horario do servidor mudam", () => {
    const base = entryDigest({ logId: "log-1", entry: entryOf(), writtenAt: WRITTEN_AT });
    expect(entryDigest({ logId: "log-2", entry: entryOf(), writtenAt: WRITTEN_AT })).not.toBe(base);
    expect(entryDigest({ logId: "log-1", entry: entryOf(), writtenAt: "2026-11-17T12:00:01.000Z" })).not.toBe(base);
  });

  // A pseudonimizacao troca estes campos a pedido do titular: se o resumo os
  // cobrisse, atender um pedido quebraria a corrente de toda organizacao.
  it("nao muda quando a pseudonimizacao troca resumo, nome ou id do recurso", () => {
    const base = entryDigest({ logId: "log-1", entry: entryOf(), writtenAt: WRITTEN_AT });
    const redacted = entryOf({
      summary: "[conteúdo removido a pedido do titular dos dados]",
      actorName: "Pessoa removida",
      resource: { type: "client", id: "titular-removido-abc" },
      updatedBy: "backend",
      privacyRedaction: { scope: "CLIENT_ERASURE", requestId: "pedido-1" },
    });
    expect(entryDigest({ logId: "log-1", entry: redacted, writtenAt: WRITTEN_AT })).toBe(base);
  });

  it("le `Timestamp` do banco e ISO do dominio como a mesma entrada", () => {
    const at = new Date(WRITTEN_AT);
    const stored = entryOf({ occurredAt: { toDate: () => at }, createdAt: { toDate: () => at } });
    expect(entryDigest({ logId: "log-1", entry: stored, writtenAt: WRITTEN_AT })).toBe(
      entryDigest({ logId: "log-1", entry: entryOf(), writtenAt: WRITTEN_AT }),
    );
  });
});

describe("corrente", () => {
  it("comeca no indice 1, sem elo anterior", () => {
    const seal = nextSeal({ logId: "log-1", entry: entryOf(), writtenAt: WRITTEN_AT });
    expect(seal.index).toBe(1);
    expect(seal.previousSealHash).toBeNull();
    expect(seal.sealHash).toBe(sealDigest(seal));
  });

  it("encadeia o resumo do selo anterior", () => {
    const { seals } = chainOf(3);
    expect(seals.map((seal) => seal.index)).toEqual([1, 2, 3]);
    expect(seals[1].previousSealHash).toBe(seals[0].sealHash);
    expect(seals[2].previousSealHash).toBe(seals[1].sealHash);
  });
});

describe("verificacao", () => {
  it("aceita a corrente intacta", () => {
    const { seals, entries } = chainOf(4);
    expect(verifyAuditSealChain({ seals, entries })).toMatchObject({ ok: true, problems: [], sealed: 4 });
  });

  it("aceita a corrente lida fora de ordem", () => {
    const { seals, entries } = chainOf(3);
    expect(verifyAuditSealChain({ seals: [seals[2], seals[0], seals[1]], entries }).ok).toBe(true);
  });

  it("acusa buraco quando um selo e removido do meio", () => {
    const { seals, entries } = chainOf(3);
    const result = verifyAuditSealChain({ seals: [seals[0], seals[2]], entries });
    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.kind)).toEqual(
      expect.arrayContaining(["GAP", "BROKEN_LINK", "SEAL_MISSING"]),
    );
  });

  it("acusa indice repetido", () => {
    const { seals, entries } = chainOf(2);
    const result = verifyAuditSealChain({ seals: [seals[0], seals[1], { ...seals[1] }], entries });
    expect(result.problems.map((problem) => problem.kind)).toContain("DUPLICATE_INDEX");
  });

  it("acusa reordenacao: os mesmos selos com os indices trocados", () => {
    const { seals, entries } = chainOf(3);
    const trocados = [seals[0], { ...seals[2], index: 2 }, { ...seals[1], index: 3 }];
    const result = verifyAuditSealChain({ seals: trocados, entries });
    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.kind)).toEqual(
      expect.arrayContaining(["BROKEN_LINK", "SEAL_CHANGED"]),
    );
  });

  it("acusa selo adulterado", () => {
    const { seals, entries } = chainOf(2);
    const result = verifyAuditSealChain({
      seals: [seals[0], { ...seals[1], entryHash: "0".repeat(64) }],
      entries,
    });
    expect(result.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "SEAL_CHANGED", index: 2 })]),
    );
  });

  it("acusa entrada adulterada num campo protegido", () => {
    const { seals, entries } = chainOf(2);
    const adulterada = entries.map((entry) => (entry.id === "log-2" ? { ...entry, action: "DELETE" } : entry));
    const result = verifyAuditSealChain({ seals, entries: adulterada });
    expect(result.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "ENTRY_CHANGED", logId: "log-2" })]),
    );
  });

  it("nao acusa entrada pseudonimizada", () => {
    const { seals, entries } = chainOf(2);
    const pseudonimizada = entries.map((entry) => ({
      ...entry,
      summary: "[conteúdo removido a pedido do titular dos dados]",
      actorName: "Pessoa removida",
      resource: { type: entry.resource.type, id: "titular-removido-abc" },
    }));
    expect(verifyAuditSealChain({ seals, entries: pseudonimizada }).ok).toBe(true);
  });

  it("acusa entrada apagada e entrada sem selo", () => {
    const { seals, entries } = chainOf(2);
    const semEntrada = verifyAuditSealChain({ seals, entries: [entries[0]] });
    expect(semEntrada.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "ENTRY_MISSING", logId: "log-2" })]),
    );
    const semSelo = verifyAuditSealChain({ seals: [seals[0]], entries });
    expect(semSelo.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "SEAL_MISSING", logId: "log-2" })]),
    );
  });

  // Ligar o selo numa organizacao que ja tem trilha nao pode acusar buraco na
  // trilha anterior: o selo nao existia quando aquelas entradas foram escritas.
  it("deixa fora da conta a trilha anterior ao selo", () => {
    const { seals, entries } = chainOf(1);
    const antiga = entryOf({ id: "log-antigo", createdAt: "2026-10-01T10:00:00.000Z" });
    const result = verifyAuditSealChain({
      seals,
      entries: [antiga, ...entries],
      sealedFrom: "2026-11-01T00:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: true, outsideChain: 1 });
  });

  it("aceita organizacao sem trilha nenhuma", () => {
    expect(verifyAuditSealChain()).toMatchObject({ ok: true, sealed: 0 });
  });
});
