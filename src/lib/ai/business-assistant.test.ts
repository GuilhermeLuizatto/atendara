import { describe, expect, it } from "vitest";

import { buildMockDataset } from "@/mocks";
import { permissionsForRole } from "@/config/permissions";

import {
  answerBusinessQuestion,
  classifyBusinessQuestion,
} from "./business-assistant";

const NOW = "2026-09-29T12:00:00.000Z";

function context() {
  const snapshot = buildMockDataset("PSYCHOLOGIST", new Date(NOW));
  const professionalId = snapshot.professionals[0].id;
  return {
    professionalId,
    timezone: snapshot.organization.timezone,
    locale: snapshot.organization.locale,
    currency: snapshot.organization.currency,
    permissions: permissionsForRole("OWNER"),
    appointments: snapshot.appointments,
    clients: snapshot.clients,
    transactions: snapshot.transactions,
    now: NOW,
  } as const;
}

describe("chat da Dara para o profissional", () => {
  it("aceita somente agenda, financeiro e leads", () => {
    expect(classifyBusinessQuestion("Como está minha agenda hoje?")).toBe(
      "AGENDA",
    );
    expect(classifyBusinessQuestion("Quanto tenho a receber?")).toBe("FINANCE");
    expect(classifyBusinessQuestion("Quais leads estão abertos?")).toBe(
      "LEADS",
    );
    expect(classifyBusinessQuestion("Resuma a conversa da paciente")).toBe(
      "UNSUPPORTED",
    );
  });

  it("recusa tema fora do negócio autorizado", () => {
    expect(
      answerBusinessQuestion("Qual diagnóstico devo dar?", context()),
    ).toMatchObject({
      topic: "UNSUPPORTED",
    });
  });

  it("não amplia permissão da sessão", () => {
    const input = context();
    expect(
      answerBusinessQuestion("Mostre meu financeiro", {
        ...input,
        permissions: input.permissions.filter(
          (permission) => permission !== "transaction:read",
        ),
      }).text,
    ).toContain("não permite");
  });

  it("filtra novamente pelo profissional ativo", () => {
    const input = context();
    const other = "outro-profissional";
    const result = answerBusinessQuestion("Minha agenda hoje", {
      ...input,
      professionalId: other,
    });
    expect(result.text).toContain("não tem atendimentos");
  });
});
