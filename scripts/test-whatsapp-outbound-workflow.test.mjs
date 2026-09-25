import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O fluxo de SAÍDA do WhatsApp no n8n, nó a nó, sem n8n e sem rede.
 *
 * O sandbox (`npm run test:whatsapp:sandbox`) prova o fluxo inteiro num n8n
 * descartável; aqui ficam as decisões de cada nó, rápidas o bastante para a
 * suíte normal: o que é aceito, o que vai para a Meta e como o erro dela volta.
 */

const workflow = JSON.parse(readFileSync(new URL("../automation/n8n/atendara-whatsapp.json", import.meta.url), "utf8"));
const code = (name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(`Nó ausente no fluxo: ${name}`);
  return String(found.parameters.jsCode);
};
const run = (name, scope) => {
  const execute = new Function("$input", "$json", "$env", "$", "require", code(name));
  return execute(scope.$input, scope.$json, scope.$env, scope.$, createRequire(import.meta.url))[0].json;
};

const SEGREDO = "segredo-de-tarefa-de-teste";
const REMETENTE = "1236644296208358";
const futuro = () => new Date(Date.now() + 10 * 60_000).toISOString();

function tarefa(patch = {}) {
  return {
    version: 2,
    taskId: "tarefa-1",
    organizationId: "org-1",
    attempt: 1,
    idempotencyKey: "tarefa-1",
    expiresAt: futuro(),
    channel: "WHATSAPP",
    providerSenderId: REMETENTE,
    deliveryId: "tarefa-1",
    destination: "+5500900000000",
    body: "Pronto! Seu atendimento ficou para quarta-feira, 30 de setembro, às 08:30.",
    ...patch,
  };
}

const MODELO = { name: "atendara_lembrete_horario", language: "pt_BR", parameters: ["Alex", "Estúdio"], buttons: [] };

function conferir(corpo) {
  const raw = JSON.stringify(corpo);
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", SEGREDO).update(`${timestamp}.${raw}`).digest("hex");
  return run("Conferir assinatura", {
    $input: {
      first: () => ({
        json: { headers: { "x-atendara-timestamp": timestamp, "x-atendara-signature": signature } },
        binary: { data: { data: Buffer.from(raw, "utf8").toString("base64") } },
      }),
    },
    $env: { ATENDARA_TASK_SECRET: SEGREDO },
  });
}

describe("a conferência da tarefa", () => {
  it("aceita a resposta na conversa como texto, sem modelo", () => {
    expect(conferir(tarefa({ messageType: "TEXT" }))).toMatchObject({ aceita: true, motivo: "OK" });
  });

  it("aceita o aviso por modelo, na versão 2 e na versão 1, que não dizia o tipo", () => {
    expect(conferir(tarefa({ messageType: "TEMPLATE", template: MODELO }))).toMatchObject({ aceita: true });
    expect(conferir(tarefa({ version: 1, template: MODELO }))).toMatchObject({ aceita: true });
  });

  it("recusa texto vazio, texto com modelo junto e tipo desconhecido", () => {
    expect(conferir(tarefa({ messageType: "TEXT", body: "   " }))).toMatchObject({ aceita: false, motivo: "NO_TEXT" });
    expect(conferir(tarefa({ messageType: "TEXT", template: MODELO }))).toMatchObject({
      aceita: false,
      motivo: "NO_TEXT",
    });
    expect(conferir(tarefa({ messageType: "AUDIO" }))).toMatchObject({
      aceita: false,
      motivo: "UNKNOWN_MESSAGE_TYPE",
    });
  });

  it("aviso sem modelo continua recusado, como antes", () => {
    expect(conferir(tarefa({ messageType: "TEMPLATE" }))).toMatchObject({ aceita: false, motivo: "NO_TEMPLATE" });
    expect(conferir(tarefa({ version: 1 }))).toMatchObject({ aceita: false, motivo: "NO_TEMPLATE" });
  });
});

describe("a chamada que vai para a Meta", () => {
  const montar = (t) => run("Montar chamada da Meta", { $json: { tarefa: t } });

  it("resposta na conversa vira mensagem de texto, sem pré-visualização de link", () => {
    const { corpo, url } = montar(tarefa({ messageType: "TEXT" }));
    expect(corpo).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5500900000000",
      type: "text",
      text: { preview_url: false, body: tarefa().body },
    });
    expect(url).toBe(`https://graph.facebook.com/v25.0/${REMETENTE}/messages`);
  });

  it("aviso continua indo como modelo aprovado, com os parâmetros na ordem", () => {
    const { corpo } = montar(tarefa({ messageType: "TEMPLATE", template: MODELO }));
    expect(corpo).toMatchObject({
      type: "template",
      template: {
        name: "atendara_lembrete_horario",
        language: { code: "pt_BR" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Alex" }, { type: "text", text: "Estúdio" }] }],
      },
    });
    expect(corpo.text).toBeUndefined();
  });
});

describe("a resposta da Meta de volta ao Atendara", () => {
  const traduzir = (resposta, t = tarefa({ messageType: "TEXT" })) => {
    const saida = run("Traduzir resposta da Meta", {
      $json: resposta,
      $env: { ATENDARA_CALLBACK_SECRET: "segredo-de-retorno", ATENDARA_CALLBACK_URL: "https://exemplo.invalid/volta" },
      $: () => ({ first: () => ({ json: { tarefa: t } }) }),
    });
    return JSON.parse(saida.corpo);
  };

  it("janela de 24 horas fechada tem código próprio, e não destino inválido", () => {
    expect(traduzir({ statusCode: 400, body: { error: { code: 131047 } } })).toMatchObject({
      outcome: "REJECTED",
      failureCode: "OUTSIDE_REPLY_WINDOW",
      version: 2,
    });
  });

  it("os demais códigos continuam como estavam", () => {
    expect(traduzir({ statusCode: 400, body: { error: { code: 131026 } } })).toMatchObject({
      failureCode: "INVALID_DESTINATION",
    });
    expect(traduzir({ statusCode: 200, body: { messages: [{ id: "wamid.saida" }] } })).toMatchObject({
      outcome: "ACCEPTED",
      providerMessageId: "wamid.saida",
      failureCode: null,
    });
  });
});
