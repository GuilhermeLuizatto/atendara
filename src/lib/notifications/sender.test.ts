import { describe, expect, it } from "vitest";

import type { MessagingSender } from "@/types";

import { senderProblemFor } from "./eligibility";

/**
 * A trava que separa "a organização marcou o canal como comprovado" de "este
 * número pode falar em nome desta clínica" (13.4).
 */
function sender(patch: Partial<MessagingSender> = {}): MessagingSender {
  return {
    id: "WHATSAPP",
    organizationId: "org-1",
    channel: "WHATSAPP",
    providerId: "N8N_BRIDGE",
    providerSenderId: "1236644296208358",
    displayNumber: "+5513999990000",
    displayName: "Clínica Fictícia",
    status: "APPROVED",
    mode: "PRODUCTION",
    testRecipients: [],
    lastReason: "Número aprovado no painel da Meta.",
    createdAt: "2026-09-20T12:00:00.000Z",
    createdBy: "operadora",
    updatedAt: "2026-09-20T12:00:00.000Z",
    updatedBy: "operadora",
    ...patch,
  };
}

describe("o remetente de canal real", () => {
  it("com provedor simulado nao ha o que comprovar: nada sai do processo", () => {
    expect(senderProblemFor({ providerId: "SIMULATED", sender: null, channel: "WHATSAPP" })).toBeNull();
  });

  it("canal real sem cadastro nao envia — marcar o canal na propria configuracao nao basta", () => {
    expect(senderProblemFor({ providerId: "N8N_BRIDGE", sender: null, channel: "WHATSAPP" })).toBe(
      "SENDER_NOT_REGISTERED",
    );
  });

  it("cadastro de outro canal nao serve para este", () => {
    expect(
      senderProblemFor({ providerId: "N8N_BRIDGE", sender: sender({ channel: "SMS" }), channel: "WHATSAPP" }),
    ).toBe("SENDER_NOT_REGISTERED");
  });

  it("so remetente aprovado envia", () => {
    for (const status of ["PENDING", "REJECTED"] as const) {
      expect(senderProblemFor({ providerId: "N8N_BRIDGE", sender: sender({ status }), channel: "WHATSAPP" })).toBe(
        "SENDER_NOT_APPROVED",
      );
    }
  });

  it("em modo de teste, destino fora da lista de testadores e recusado aqui, antes de gastar tentativa", () => {
    const teste = sender({ mode: "TEST", testRecipients: ["+5513999990000"] });

    expect(
      senderProblemFor({
        providerId: "N8N_BRIDGE",
        sender: teste,
        channel: "WHATSAPP",
        destination: "+5511888887777",
      }),
    ).toBe("DESTINATION_NOT_IN_TEST_LIST");
    expect(
      senderProblemFor({ providerId: "N8N_BRIDGE", sender: teste, channel: "WHATSAPP", destination: "+5513999990000" }),
    ).toBeNull();
  });

  it("em producao a lista de testadores nao restringe ninguem", () => {
    expect(
      senderProblemFor({
        providerId: "N8N_BRIDGE",
        sender: sender(),
        channel: "WHATSAPP",
        destination: "+5511888887777",
      }),
    ).toBeNull();
  });
});
