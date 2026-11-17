import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION, LEGAL_VERSION } from "@/config/legal";

import {
  acceptanceIsCurrent,
  contractAcceptanceDocument,
} from "./contract-acceptance";

const acceptance = () =>
  contractAcceptanceDocument({
    organizationId: "org-1",
    acceptedByUserId: "user-1",
    acceptedAt: "2026-11-16T12:00:00.000Z",
    source: "SELF_SERVICE_SIGNUP",
  });

describe("Aceite do contrato", () => {
  it("guarda as duas versoes e so identificadores", () => {
    expect(acceptance()).toEqual({
      organizationId: "org-1",
      contractVersion: CONTRACT_VERSION,
      acceptedByUserId: "user-1",
      acceptedAt: "2026-11-16T12:00:00.000Z",
      source: "SELF_SERVICE_SIGNUP",
      acceptedLegalVersion: LEGAL_VERSION,
    });
  });

  it("nao deixa nome, e-mail, documento nem endereco entrarem no registro", () => {
    // O que este teste protege e a promessa do anexo: o aceite e prova de
    // concordancia, nao um cadastro paralelo de quem concordou.
    const proibidos = [
      "name",
      "displayName",
      "email",
      "cpf",
      "cnpj",
      "ip",
      "userAgent",
      "phone",
    ];
    for (const campo of Object.keys(acceptance())) {
      expect(proibidos).not.toContain(campo);
    }
  });

  it("a versao nao vem de fora: e sempre a do servidor", () => {
    // O jeito realista de a versao vazar nao e um segundo parametro: e alguem
    // acrescentar `contractVersion` ao objeto de entrada e a funcao passar a
    // confiar nele. Entao o teste manda exatamente isso, forjado, e exige que a
    // saida continue com a versao do servidor.
    const forjada = contractAcceptanceDocument({
      organizationId: "org-1",
      acceptedByUserId: "user-1",
      acceptedAt: "2026-11-16T12:00:00.000Z",
      source: "SELF_SERVICE_SIGNUP",
      contractVersion: "2020-01-01",
      acceptedLegalVersion: "2020-01-01",
    } as Parameters<typeof contractAcceptanceDocument>[0]);

    expect(forjada.contractVersion).toBe(CONTRACT_VERSION);
    expect(forjada.acceptedLegalVersion).toBe(LEGAL_VERSION);
    expect(acceptance().contractVersion).toBe(CONTRACT_VERSION);
  });

  it("silencio nao e aceite", () => {
    expect(acceptanceIsCurrent(null)).toBe(false);
    expect(acceptanceIsCurrent(undefined)).toBe(false);
    expect(acceptanceIsCurrent({ contractVersion: "2020-01-01" })).toBe(false);
    expect(acceptanceIsCurrent(acceptance())).toBe(true);
  });
});
