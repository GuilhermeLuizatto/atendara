import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION, LEGAL_VERSION, SUBPROCESSORS, SUBPROCESSOR_LOCATION_LABEL } from "./legal";

/**
 * A lista de suboperadores e uma promessa publica: o anexo e a Politica a leem.
 * Servico externo chamado pelo backend sem estar nela e tratamento escondido.
 */

const FUNCTIONS_DIR = join(process.cwd(), "functions");

/** Endereco do provedor no codigo do backend e o suboperador que o declara. */
const EXTERNAL_HOSTS: Record<string, string> = {
  "generativelanguage.googleapis.com": "google-gemini",
  "amazonaws.com": "amazon-ses",
};

function backendSources(): string {
  return readdirSync(FUNCTIONS_DIR)
    .filter((name) => name.endsWith(".js") && !name.includes(".test."))
    .map((name) => readFileSync(join(FUNCTIONS_DIR, name), "utf8"))
    .join("\n");
}

describe("versões dos textos legais", () => {
  it("datam o texto, para saber sobre qual versão alguém concordou", () => {
    for (const version of [LEGAL_VERSION, CONTRACT_VERSION]) {
      expect(version).toMatch(/^\d{4}-\d{2}-\d{2}(-[a-z]+)?$/);
    }
  });
});

describe("suboperadores", () => {
  it("tem identificador único e todos os campos preenchidos", () => {
    const ids = SUBPROCESSORS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of SUBPROCESSORS) {
      for (const field of [item.name, item.purpose, item.data, item.locationNote]) {
        expect(field.trim().length).toBeGreaterThan(0);
      }
      expect(SUBPROCESSOR_LOCATION_LABEL[item.location]).toBeTruthy();
    }
  });

  it("termina finalidade, dados e local com ponto, porque a página os encadeia em frases", () => {
    for (const item of SUBPROCESSORS) {
      expect(item.purpose).toMatch(/\.$/);
      expect(item.data).toMatch(/\.$/);
      expect(item.locationNote).toMatch(/\.$/);
    }
  });

  it("declara todo provedor externo que o backend chama", () => {
    const sources = backendSources();
    const ids = new Set(SUBPROCESSORS.map((item) => item.id));
    for (const [host, id] of Object.entries(EXTERNAL_HOSTS)) {
      if (sources.includes(host)) expect(ids, `${host} é chamado e ${id} não está na lista`).toContain(id);
    }
  });

  it("não lista a Stripe: na cobrança do assinante o Atendara é controlador", () => {
    expect(SUBPROCESSORS.some((item) => /stripe/i.test(item.name))).toBe(false);
  });

  it("não promete Brasil para serviço global ou de fora", () => {
    for (const item of SUBPROCESSORS.filter((entry) => entry.location !== "BRAZIL")) {
      expect(item.locationNote).not.toMatch(/São Paulo|Brasil\.$/);
    }
  });
});
