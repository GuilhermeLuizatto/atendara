import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as backend from "./index.js";
import { SERVICE_ACCOUNTS, runAs, serviceAccountsFor } from "./service-accounts.js";

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
  // Rotinas do ciclo do teste: fecham a conta vencida e, na A.5, apagam o
  // cadastro abandonado. Mesmo alcance da exclusao de organizacao.
  "trial.js": "privacidade",
  "signup-cleanup.js": "privacidade",
  "platform.js": "operadora",
  "platform-admins.js": "operadora",
  "profession-change.js": "operadora",
  "privacy.js": "privacidade",
  "billing.js": "cobranca",
  "automation.js": "automacao",
  "automation-expiry.js": "automacao",
  // A volta da ponte do n8n muda estado de tarefa e grava a trilha do aviso:
  // mesmo alcance do despachante, e nada alem dele.
  "automation-callback.js": "automacao",
  // Cadastro do remetente e ato da operadora, como concessao e revogacao.
  "messaging-senders.js": "operadora",
  // A entrada grava mensagem, conversa e decisao do tenant: mesmo alcance da
  // fila que a alimenta.
  "inbound.js": "automacao",
  "ai-preview.js": "automacao",
  // A agenda externa e da automacao: e ela que sincroniza e le ocupado.
  "calendar.js": "automacao",
  "automation-control.js": "automacao",
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
    expect(runAs("contas")).toEqual({ serviceAccount: SERVICE_ACCOUNTS.contas });
    expect(() => runAs("inventado")).toThrow("sem conta de servico");
  });
});

/**
 * O que a CLI le ao publicar: ela roda este codigo com `GCLOUD_PROJECT` do
 * projeto. Em 18/09/2026 a forma curta `fn-cobranca@` derrubou a publicacao,
 * porque a CLI a manda sem completar ao dar acesso aos segredos e ao criar o
 * agendamento das rotinas. Com o projeto conhecido, nenhuma conta pode sair curta.
 */
describe("Conta de servico com o projeto que a CLI informa", () => {
  const PROJECT = "atendo-a3481";

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("monta o e-mail completo de cada grupo", () => {
    expect(serviceAccountsFor(PROJECT)).toEqual({
      contas: "fn-contas@atendo-a3481.iam.gserviceaccount.com",
      operadora: "fn-operadora@atendo-a3481.iam.gserviceaccount.com",
      privacidade: "fn-privacidade@atendo-a3481.iam.gserviceaccount.com",
      cobranca: "fn-cobranca@atendo-a3481.iam.gserviceaccount.com",
      automacao: "fn-automacao@atendo-a3481.iam.gserviceaccount.com",
    });
  });

  it("nenhuma function, rotina ou fila publica conta na forma curta", async () => {
    vi.stubEnv("GCLOUD_PROJECT", PROJECT);
    vi.resetModules();
    const publicado = await import("./index.js");
    const endpoints = Object.entries(publicado).filter(([, value]) => typeof value === "function" && value.__endpoint);
    expect(endpoints.length).toBeGreaterThanOrEqual(18);

    const completa = /^fn-[a-z]+@atendo-a3481\.iam\.gserviceaccount\.com$/;
    for (const [name, fn] of endpoints) {
      expect(fn.__endpoint.serviceAccountEmail, name).toMatch(completa);
      for (const invoker of fn.__endpoint.taskQueueTrigger?.invoker ?? []) expect(invoker, name).toMatch(completa);
    }
  });
});
