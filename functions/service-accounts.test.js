import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as backend from "./index.js";
import { SERVICE_ACCOUNTS, runAs } from "./service-accounts.js";

/**
 * Menor privilegio (H.3), conferido pelo que a CLI do Firebase le.
 *
 * `__endpoint` e o manifesto que a CLI usa para publicar: se a conta aparece
 * aqui, e com ela que a function roda. Sem mock nenhum, de proposito — um mock
 * das opcoes provaria so que o mock guardou o que recebeu.
 *
 * Uma function nova sem conta propria, ou com a conta de outro grupo, quebra
 * este teste antes de chegar ao deploy.
 */

/** Arquivo de origem -> grupo. Cada arquivo e um assunto, e cada assunto uma conta. */
const GROUP_OF_FILE = {
  "index.js": "contas",
  "self-service.js": "contas",
  "platform.js": "operadora",
  "platform-admins.js": "operadora",
  "privacy.js": "privacidade",
  "billing.js": "cobranca",
  "automation.js": "automacao",
};

function sourceFileOf(name) {
  const here = new URL(".", import.meta.url);
  const files = readdirSync(here).filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"));
  return files.find((file) => readFileSync(new URL(file, here), "utf8").includes(`export const ${name} = `));
}

const functions = Object.entries(backend).filter(([, value]) => typeof value === "function" && value.__endpoint);

describe("Conta de servico de cada function", () => {
  it("encontra as functions exportadas", () => {
    // Guarda contra o teste passar vazio porque o import mudou de forma.
    expect(functions.length).toBeGreaterThanOrEqual(18);
  });

  it.each(functions)("%s roda com a conta do proprio grupo", (name, fn) => {
    const file = sourceFileOf(name);
    expect(file, `${name} nao foi encontrada em nenhum arquivo`).toBeDefined();
    const group = GROUP_OF_FILE[file];
    expect(group, `${file} nao tem grupo: decida qual conta ele usa`).toBeDefined();
    expect(fn.__endpoint.serviceAccountEmail).toBe(SERVICE_ACCOUNTS[group]);
  });

  it("nenhuma function usa a conta padrao nem uma conta fora da lista", () => {
    const allowed = new Set(Object.values(SERVICE_ACCOUNTS));
    for (const [name, fn] of functions) {
      expect(allowed.has(fn.__endpoint.serviceAccountEmail), name).toBe(true);
    }
  });

  it("so a conta da automacao enfileira e chama o despachante", () => {
    for (const [name, fn] of functions) {
      const trigger = fn.__endpoint.taskQueueTrigger;
      if (!trigger) continue;
      // Sem `invoker`, a CLI deixaria a fila com a conta padrao do projeto.
      expect(trigger.invoker, name).toEqual([SERVICE_ACCOUNTS.automacao]);
    }
  });

  it("recusa grupo desconhecido em vez de rodar sem conta", () => {
    expect(runAs("contas")).toEqual({ serviceAccount: "fn-contas@" });
    expect(() => runAs("inventado")).toThrow("sem conta de servico");
  });
});
