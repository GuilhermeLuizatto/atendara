import { describe, expect, it, vi } from "vitest";

import { createMetaCloudApiProvider, metaCloudMessage } from "./meta-cloud-api";
import type { SendRequest } from "./types";

const REQUEST: SendRequest = {
  deliveryId: "entrega-1",
  channel: "WHATSAPP",
  destination: "+5513999990000",
  providerSenderId: "123456789",
  body: "Seu atendimento é amanhã às 10h.",
  attempt: 1,
  taskId: "tarefa-1",
  organizationId: "org-1",
  idempotencyKey: "chave-1",
  expiresAt: "2026-11-20T13:00:00.000Z",
};

const REPLY: SendRequest = { ...REQUEST, freeText: true };

const NOTICE: SendRequest = {
  ...REQUEST,
  template: {
    name: "lembrete_atendimento",
    language: "pt_BR",
    parameters: ["Maria", "Clínica Exemplo", "20/11", "10:00"],
    buttons: ["CONFIRM", "RESCHEDULE"],
  },
};

function provider(fetchImpl: typeof fetch) {
  return createMetaCloudApiProvider({
    graphVersion: "v25.0",
    authorization: () => "Bearer token-de-teste",
    host: "https://graph.exemplo.invalid",
    fetchImpl,
  });
}

function responded(status: number, body: unknown = {}) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("o provedor da Cloud API", () => {
  it("fala direto com a Meta, entao o resultado do pedido e o resultado do envio", () => {
    expect(provider(responded(200))).toMatchObject({
      id: "META_CLOUD_API",
      simulated: false,
      handoff: false,
    });
  });

  it("manda para a URL do remetente aprovado, com a versao da Graph", async () => {
    const fetchImpl = responded(200, { messages: [{ id: "wamid.1" }] });
    await provider(fetchImpl).send(REPLY);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.exemplo.invalid/v25.0/123456789/messages");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer token-de-teste",
    );
  });

  it("resposta em conversa sai como texto, sem previa de link", () => {
    expect(metaCloudMessage(REPLY)).toMatchObject({
      messaging_product: "whatsapp",
      to: "+5513999990000",
      type: "text",
      text: { preview_url: false, body: REQUEST.body },
    });
  });

  it("aviso sai como modelo aprovado, com os valores na ordem e os botoes numerados", () => {
    const message = metaCloudMessage(NOTICE) as {
      type: string;
      template: {
        name: string;
        language: { code: string };
        components: { type: string; index?: string; parameters: unknown[] }[];
      };
    };

    expect(message.type).toBe("template");
    expect(message.template.name).toBe("lembrete_atendimento");
    expect(message.template.language.code).toBe("pt_BR");
    expect(message.template.components[0]).toEqual({
      type: "body",
      parameters: [
        { type: "text", text: "Maria" },
        { type: "text", text: "Clínica Exemplo" },
        { type: "text", text: "20/11" },
        { type: "text", text: "10:00" },
      ],
    });
    expect(message.template.components[1]).toMatchObject({
      type: "button",
      index: "0",
      parameters: [{ type: "payload", payload: "CONFIRM" }],
    });
    expect(message.template.components[2]).toMatchObject({ index: "1" });
  });

  it("recusa montar envio com modelo e texto livre ao mesmo tempo", () => {
    expect(() => metaCloudMessage({ ...NOTICE, freeText: true })).toThrow(
      /modelo e texto livre/,
    );
  });

  it("recusa montar envio que nao e modelo nem resposta", () => {
    expect(() => metaCloudMessage(REQUEST)).toThrow(/sem modelo e sem resposta/);
  });

  it("sem Phone Number ID nao chega a chamar a Meta", async () => {
    const fetchImpl = responded(200);
    const result = await provider(fetchImpl).send({
      ...REPLY,
      providerSenderId: undefined,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({
      outcome: "REJECTED",
      providerMessageId: null,
      failureCode: "SENDER_NOT_ALLOWED",
    });
  });

  it("aceite guarda o protocolo da Meta", async () => {
    const result = await provider(
      responded(200, { messages: [{ id: "wamid.HBgM" }] }),
    ).send(REPLY);

    expect(result).toEqual({
      outcome: "ACCEPTED",
      providerMessageId: "wamid.HBgM",
      failureCode: null,
    });
  });

  it("janela de 24 horas fechada e recusa nomeada, nao destino invalido", async () => {
    const result = await provider(
      responded(400, { error: { code: 131047, message: "Re-engagement message" } }),
    ).send(REPLY);

    expect(result).toEqual({
      outcome: "REJECTED",
      providerMessageId: null,
      failureCode: "OUTSIDE_REPLY_WINDOW",
    });
  });

  it("limite de taxa e falha passageira, e ganha nova tentativa", async () => {
    const result = await provider(
      responded(400, { error: { code: 130429 } }),
    ).send(REPLY);

    expect(result).toMatchObject({
      outcome: "TEMPORARY_FAILURE",
      failureCode: "RATE_LIMITED",
    });
  });

  it("token invalido culpa o remetente, nao o destino", async () => {
    const result = await provider(
      responded(401, { error: { code: 190 } }),
    ).send(REPLY);

    expect(result).toMatchObject({
      outcome: "REJECTED",
      failureCode: "SENDER_NOT_ALLOWED",
    });
  });

  it("erro do lado da Meta e passageiro", async () => {
    const result = await provider(responded(503)).send(REPLY);

    expect(result).toMatchObject({
      outcome: "TEMPORARY_FAILURE",
      failureCode: "PROVIDER_UNAVAILABLE",
    });
  });

  it("4xx sem codigo conhecido vira recusa, porque repetir daria o mesmo erro", async () => {
    const result = await provider(responded(400, { error: { code: 100 } })).send(
      REPLY,
    );

    expect(result).toMatchObject({
      outcome: "REJECTED",
      failureCode: "INVALID_DESTINATION",
    });
  });

  it("rede fora nao diz se a mensagem saiu: falha passageira", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("sem rede");
    });
    const result = await provider(fetchImpl).send(REPLY);

    expect(result).toMatchObject({
      outcome: "TEMPORARY_FAILURE",
      failureCode: "PROVIDER_UNAVAILABLE",
    });
  });
});
