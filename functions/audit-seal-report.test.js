import { describe, expect, it } from "vitest";

import { nextSeal } from "./audit-seal-chain.js";
import {
  boundaryOf,
  buildReport,
  countByKind,
  formatLines,
  parseVerifyArguments,
  verifyOrganization,
} from "./audit-seal-report.js";

/**
 * A conferencia da trilha selada, sem banco.
 *
 * O que estes testes protegem: o script nao roda no projeto errado; a trilha
 * anterior ao selo nao e acusada de falta de selo; o relatorio nao carrega dado
 * pessoal; e trilha com problema nao termina em sucesso.
 */

const WRITTEN_AT = "2026-11-18T12:00:00.000Z";

function entryOf(id, patch = {}) {
  return {
    id,
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
    ...patch,
  };
}

/** Uma corrente pronta, como o gatilho a teria gravado. */
function chainOf(count, { from = WRITTEN_AT } = {}) {
  const seals = [];
  const entries = [];
  let previous = null;
  for (let position = 1; position <= count; position += 1) {
    const logId = `log-${position}`;
    const writtenAt = new Date(Date.parse(from) + position * 1000).toISOString();
    const entry = entryOf(logId, { createdAt: writtenAt, occurredAt: writtenAt });
    const seal = nextSeal({ logId, entry, writtenAt, previous });
    previous = { index: seal.index, sealHash: seal.sealHash };
    seals.push(seal);
    entries.push(entry);
  }
  return { seals, entries };
}

describe("argumentos da conferência", () => {
  it("exige o projeto de produção escrito por extenso", () => {
    expect(parseVerifyArguments(["atendo-a3481"], {})).toMatchObject({
      projectId: "atendo-a3481",
      emulator: false,
      organizationId: null,
    });
    expect(() => parseVerifyArguments([], {})).toThrow("atendo-a3481");
    expect(() => parseVerifyArguments(["outro-projeto"], {})).toThrow("atendo-a3481");
  });

  it("contra o emulador aceita somente projeto demo-*", () => {
    const env = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };
    expect(parseVerifyArguments(["demo-atendara"], env).emulator).toBe(true);
    expect(() => parseVerifyArguments(["atendo-a3481"], env)).toThrow("demo-*");
  });

  it("lê a organização e o limite, e recusa data que não é data", () => {
    const args = ["atendo-a3481", "--organizacao", "org-a", "--selado-desde", WRITTEN_AT];
    expect(parseVerifyArguments(args, {})).toMatchObject({ organizationId: "org-a", sealedFrom: WRITTEN_AT });
    expect(() => parseVerifyArguments(["atendo-a3481", "--selado-desde", "ontem"], {})).toThrow("ISO");
    // Opcao sem valor nao vira o nome da opcao seguinte.
    expect(parseVerifyArguments(["atendo-a3481", "--organizacao", "--selado-desde", WRITTEN_AT], {})).toMatchObject({
      organizationId: null,
      sealedFrom: WRITTEN_AT,
    });
  });
});

describe("limite da trilha selada", () => {
  it("usa o horário do primeiro selo quando ninguém informa", () => {
    const { seals } = chainOf(3);
    expect(boundaryOf(seals)).toBe(seals[0].writtenAt);
    // Ordem de leitura nao importa: o limite e o selo de indice 1.
    expect(boundaryOf([seals[2], seals[1], seals[0]])).toBe(seals[0].writtenAt);
  });

  it("respeita o limite informado e aceita organização sem selo", () => {
    expect(boundaryOf(chainOf(2).seals, WRITTEN_AT)).toBe(WRITTEN_AT);
    expect(boundaryOf([])).toBeNull();
  });
});

describe("conferência de uma organização", () => {
  it("aprova a corrente íntegra", () => {
    const { seals, entries } = chainOf(3);
    expect(verifyOrganization({ organizationId: "org-a", seals, entries })).toMatchObject({
      organizationId: "org-a",
      ok: true,
      seals: 3,
      entries: 3,
      sealed: 3,
      problems: [],
    });
  });

  // E o caso da primeira conferencia depois de publicar: a trilha ja existia.
  it("não acusa falta de selo na trilha anterior ao selo", () => {
    const { seals, entries } = chainOf(2);
    const antiga = entryOf("log-antigo", { createdAt: "2026-10-01T10:00:00.000Z" });
    const result = verifyOrganization({ organizationId: "org-a", seals, entries: [antiga, ...entries] });
    expect(result).toMatchObject({ ok: true, outsideChain: 1, entries: 3, sealed: 2 });
  });

  it("acusa selo removido e entrada adulterada, com o tipo de cada problema", () => {
    const { seals, entries } = chainOf(3);
    const adulterada = entries.map((entry) => (entry.id === "log-1" ? { ...entry, action: "DELETE" } : entry));
    const result = verifyOrganization({
      organizationId: "org-a",
      seals: [seals[0], seals[2]],
      entries: adulterada,
    });
    expect(result.ok).toBe(false);
    expect(result.counts).toMatchObject({ ENTRY_CHANGED: 1, SEAL_MISSING: 1 });
  });

  // A trilha e conferida pela corrente, nao pelo conteudo: um relatorio em
  // disco nao precisa carregar nome de paciente.
  it("não deixa dado pessoal entrar no relatório", () => {
    const { seals, entries } = chainOf(2);
    const result = verifyOrganization({
      organizationId: "org-a",
      seals: [seals[0]],
      entries: entries.map((entry) => ({ ...entry, action: "DELETE" })),
    });
    const texto = JSON.stringify(result);
    for (const pessoal of ["Maria", "Quem registrou", "cliente-1", "membro-1"]) {
      expect(texto, pessoal).not.toContain(pessoal);
    }
    expect(result.problems[0]).toEqual({ kind: "ENTRY_CHANGED", logId: "log-1", index: 1, expected: null });
  });
});

describe("relatório", () => {
  const at = "2026-11-18T13:00:00.000Z";

  it("soma as organizações e termina em sucesso quando tudo fecha", () => {
    const { seals, entries } = chainOf(2);
    const organizations = [verifyOrganization({ organizationId: "org-a", seals, entries })];
    const { report, exitCode } = buildReport({ projectId: "atendo-a3481", runId: "execucao-1", at, organizations });
    expect(exitCode).toBe(0);
    expect(report.summary).toEqual({ organizations: 1, withProblems: 0, seals: 2, entries: 2 });
    expect(formatLines(report)).toEqual([
      "org-a: 2 selo(s), 2 entrada(s) — corrente íntegra",
      "1 organização(ões) conferida(s), nenhuma divergência.",
    ]);
  });

  it("falha quando alguma organização tem problema", () => {
    const { seals, entries } = chainOf(2);
    const organizations = [
      verifyOrganization({ organizationId: "org-a", seals, entries }),
      verifyOrganization({ organizationId: "org-b", seals: [seals[1]], entries }),
    ];
    const { report, exitCode } = buildReport({ projectId: "atendo-a3481", runId: "execucao-2", at, organizations });
    expect(exitCode).toBe(1);
    expect(report.summary).toMatchObject({ organizations: 2, withProblems: 1 });
    expect(formatLines(report).at(-1)).toBe("1 de 2 organização(ões) com problema na trilha.");
    expect(formatLines(report)[1]).toContain("PROBLEMA:");
  });

  it("conta os problemas por tipo", () => {
    expect(countByKind([{ kind: "GAP" }, { kind: "GAP" }, { kind: "BROKEN_LINK" }])).toEqual({
      GAP: 2,
      BROKEN_LINK: 1,
    });
  });
});
