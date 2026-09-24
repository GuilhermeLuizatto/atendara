import { describe, expect, it } from "vitest";

import { ASSISTANT_NAME, CONVERSATION_REPLY_TEXTS, REPLY_MAX_BODY_LENGTH } from "@/config/assistant";
import { FORBIDDEN_TEMPLATE_TERMS } from "@/config/notifications";
import { CONVERSATION_REPLY_EVENTS } from "@/types";

import { renderReply } from "./replies";

const PESSOA = { clientName: "Alex", organizationName: "Estúdio Exemplo" };

// Quarta-feira, 30/09/2026: 08:00, 08:30 e 14:00 em Brasília.
const HORARIOS = [
  { startsAt: "2026-09-30T11:00:00.000Z" },
  { startsAt: "2026-09-30T11:30:00.000Z" },
  { startsAt: "2026-10-01T17:00:00.000Z" },
];

function texto(resultado: ReturnType<typeof renderReply>): string {
  if (!resultado.ok) throw new Error(resultado.error);
  return resultado.value;
}

describe("oferta de horários", () => {
  it("apresenta a assistente e numera uma opção por linha, na ordem da escolha", () => {
    const corpo = texto(renderReply("RESCHEDULE_OFFERED", "REQUEST", { ...PESSOA, slots: HORARIOS }));

    expect(corpo).toContain(`Aqui é a ${ASSISTANT_NAME}, assistente virtual de Estúdio Exemplo.`);
    expect(corpo).toContain("Olá, Alex!");
    expect(corpo.split("\n")).toEqual(
      expect.arrayContaining([
        "1. quarta-feira, 30 de setembro, às 08:00",
        "2. quarta-feira, 30 de setembro, às 08:30",
        "3. quinta-feira, 1 de outubro, às 14:00",
      ]),
    );
    // O prazo dito à pessoa é o da reserva, não um número escrito à mão.
    expect(corpo).toContain("nos próximos 10 minutos");
  });

  it("sem horários não sai oferta pela metade", () => {
    expect(renderReply("RESCHEDULE_OFFERED", "REQUEST", { ...PESSOA, slots: [] })).toMatchObject({
      ok: false,
      error: "EMPTY",
    });
  });

  it("cinco horários cabem no teto da resposta", () => {
    const cinco = [...HORARIOS, { startsAt: "2026-10-02T12:00:00.000Z" }, { startsAt: "2026-10-05T12:00:00.000Z" }];
    const corpo = texto(renderReply("RESCHEDULE_OFFERED", "REQUEST", { ...PESSOA, slots: cinco }));
    expect(corpo.length).toBeLessThanOrEqual(REPLY_MAX_BODY_LENGTH);
  });
});

describe("confirmação e encaminhamento", () => {
  it("a confirmação diz o horário novo, e só ele", () => {
    const corpo = texto(
      renderReply("RESCHEDULE_CONFIRMED", "CHOICE", { ...PESSOA, startsAt: "2026-09-30T11:30:00.000Z" }),
    );
    expect(corpo).toBe("Pronto! Seu atendimento ficou para quarta-feira, 30 de setembro, às 08:30.");
  });

  it("confirmação sem horário não sai", () => {
    expect(renderReply("RESCHEDULE_CONFIRMED", "CHOICE", PESSOA)).toMatchObject({ ok: false, error: "EMPTY" });
  });

  it("o encaminhamento não diz o motivo, e se apresenta só quando ainda não houve oferta", () => {
    const antes = texto(renderReply("RESCHEDULE_HANDED_OFF", "REQUEST", PESSOA));
    const depois = texto(renderReply("RESCHEDULE_HANDED_OFF", "CHOICE", PESSOA));

    expect(antes).toContain("assistente virtual");
    expect(antes).toContain("A equipe vai falar com você por aqui.");
    expect(depois).not.toContain("assistente virtual");
    expect(depois).toContain("acabou de ficar indisponível");
    for (const corpo of [antes, depois]) {
      expect(corpo).not.toMatch(/limite|antecedência|política/i);
    }
  });

  it("combinação que não existe não vira mensagem", () => {
    expect(renderReply("RESCHEDULE_OFFERED", "CHOICE", { ...PESSOA, slots: HORARIOS })).toMatchObject({
      ok: false,
      error: "EMPTY",
    });
    expect(renderReply("RESCHEDULE_CONFIRMED", "REQUEST", PESSOA)).toMatchObject({ ok: false, error: "EMPTY" });
  });
});

describe("a barreira de conteúdo", () => {
  it("nenhum texto da assistente carrega vocabulário proibido nos avisos", () => {
    const fold = (valor: string) =>
      valor
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase();
    for (const event of CONVERSATION_REPLY_EVENTS) {
      for (const paragrafos of Object.values(CONVERSATION_REPLY_TEXTS[event])) {
        for (const paragrafo of paragrafos) {
          for (const termo of FORBIDDEN_TEMPLATE_TERMS) {
            expect(fold(paragrafo), `${event}: ${termo}`).not.toContain(termo);
          }
        }
      }
    }
  });

  it("valor de variável com vocabulário proibido derruba a mensagem", () => {
    expect(
      renderReply("RESCHEDULE_HANDED_OFF", "REQUEST", { ...PESSOA, organizationName: "Clínica do Tratamento" }),
    ).toMatchObject({ ok: false, error: "FORBIDDEN_TERM" });
  });
});
