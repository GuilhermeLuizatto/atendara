import { describe, expect, it, vi } from "vitest";

import { BRIDGE_SIGNATURE_HEADER, BRIDGE_TIMESTAMP_HEADER } from "@/lib/automation/bridge";

import { createN8nBridgeProvider } from "./n8n-bridge";
import type { SendRequest } from "./types";

const REQUEST: SendRequest = {
  deliveryId: "entrega-1",
  channel: "WHATSAPP",
  destination: "+5513999990000",
  body: "Seu atendimento é amanhã às 10h.",
  attempt: 1,
  taskId: "tarefa-1",
  organizationId: "org-1",
  idempotencyKey: "chave-1",
  expiresAt: "2026-09-20T13:00:00.000Z",
};

const NOW = new Date("2026-09-20T12:00:00.000Z");

function bridge(fetchImpl: typeof fetch) {
  return createN8nBridgeProvider({
    webhookUrl: "https://n8n.exemplo.invalid/webhook/atendara",
    sign: (timestamp, body) => `assinatura(${timestamp}:${body.length})`,
    fetchImpl,
    clock: () => NOW,
  });
}

function responded(status: number, body: unknown = {}) {
  return vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("a ponte com o n8n", () => {
  it("nao e provedor simulado e entrega em duas etapas", () => {
    const provider = bridge(responded(200));
    expect(provider).toMatchObject({ id: "N8N_BRIDGE", simulated: false, handoff: true });
  });

  it("assina o corpo exato que vai no pedido, com o horario no cabecalho", async () => {
    const fetchImpl = responded(200, { handoffId: "exec-42" });
    await bridge(fetchImpl).send(REQUEST);

    const [url, init] = fetchImpl.mock.calls[0];
    const headers = init!.headers as Record<string, string>;
    expect(url).toBe("https://n8n.exemplo.invalid/webhook/atendara");
    expect(headers[BRIDGE_TIMESTAMP_HEADER]).toBe(NOW.toISOString());
    expect(headers[BRIDGE_SIGNATURE_HEADER]).toBe(`assinatura(${NOW.toISOString()}:${String(init!.body).length})`);
    expect(JSON.parse(String(init!.body))).toMatchObject({ taskId: "tarefa-1", organizationId: "org-1" });
  });

  it("aceite do n8n e so aceite: guarda o protocolo dele, nunca como prova de entrega", async () => {
    const result = await bridge(responded(200, { handoffId: "exec-42" })).send(REQUEST);
    expect(result).toEqual({ outcome: "ACCEPTED", providerMessageId: "exec-42", failureCode: null });
  });

  it("aceita sem protocolo, com corpo vazio ou que nao e JSON", async () => {
    const semCorpo = vi.fn<typeof fetch>(async () => new Response("", { status: 200 }));
    expect(await bridge(semCorpo).send(REQUEST)).toMatchObject({ outcome: "ACCEPTED", providerMessageId: null });
  });

  it("fora do ar e limite de taxa sao falha temporaria; recusa do contrato nao ganha nova tentativa", async () => {
    expect(await bridge(responded(503)).send(REQUEST)).toMatchObject({ outcome: "TEMPORARY_FAILURE", failureCode: "PROVIDER_UNAVAILABLE" });
    expect(await bridge(responded(429)).send(REQUEST)).toMatchObject({ outcome: "TEMPORARY_FAILURE", failureCode: "RATE_LIMITED" });
    expect(await bridge(responded(401)).send(REQUEST)).toMatchObject({ outcome: "REJECTED", failureCode: "INVALID_DESTINATION" });
  });

  it("rede fora e tempo esgotado viram falha temporaria — nao se sabe se a tarefa entrou", async () => {
    const caiu = vi.fn<typeof fetch>(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await bridge(caiu).send(REQUEST)).toEqual({
      outcome: "TEMPORARY_FAILURE",
      providerMessageId: null,
      failureCode: "PROVIDER_UNAVAILABLE",
    });
  });
});
