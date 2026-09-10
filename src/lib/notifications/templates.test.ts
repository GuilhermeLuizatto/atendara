import { describe, expect, it } from "vitest";

import { PROFESSION_DEFINITIONS } from "@/config/professions/definitions";
import {
  APPOINTMENT_NOTIFICATION_EVENTS,
  PROFESSION_IDS,
} from "@/types";
import { CHANNEL_META } from "@/config/notifications";

import { hashBody, renderTemplate } from "./templates";

const context = {
  clientName: "Alex",
  organizationName: "Estudio Exemplo",
  professionalName: "Sam Ficticio",
  serviceTerm: "treino",
  date: "11/09/2026",
  time: "21:00",
};

const permissive = {
  disclosure: "TIME_PROFESSIONAL_AND_SERVICE" as const,
  maxBodyLength: 400,
};

describe("renderTemplate", () => {
  it("interpola apenas as variaveis conhecidas", () => {
    const result = renderTemplate(
      "Ola, {{clientName}}. Seu {{serviceTerm}} e {{date}} as {{time}}.",
      context,
      permissive,
    );
    expect(result).toEqual({
      ok: true,
      value: "Ola, Alex. Seu treino e 11/09/2026 as 21:00.",
    });
  });

  it("recusa variavel fora da lista", () => {
    const result = renderTemplate(
      "Ola. Observacao: {{administrativeNotes}}",
      context,
      permissive,
    );
    expect(result).toEqual({ ok: false, error: "UNKNOWN_VARIABLE" });
  });

  it("recusa variavel acima do grau de exposicao da profissao", () => {
    // O mesmo modelo passa em uma profissao e e recusado em outra: e o campo
    // `disclosure` fazendo o trabalho, nao uma excecao escrita a mao.
    const template = "Lembrete do seu {{serviceTerm}} em {{date}}.";
    expect(renderTemplate(template, context, permissive).ok).toBe(true);
    expect(
      renderTemplate(template, context, {
        disclosure: "TIME_ONLY",
        maxBodyLength: 400,
      }),
    ).toEqual({ ok: false, error: "DISCLOSURE_EXCEEDED" });
  });

  it("recusa vocabulario clinico, com ou sem acento", () => {
    expect(
      renderTemplate("Lembrete do seu exame de {{date}}.", context, permissive),
    ).toEqual({ ok: false, error: "FORBIDDEN_TERM" });

    expect(
      renderTemplate("Trazer a receita médica.", context, permissive),
    ).toEqual({ ok: false, error: "FORBIDDEN_TERM" });
  });

  it("recusa texto acima do limite do canal", () => {
    expect(
      renderTemplate("x".repeat(200), context, {
        disclosure: "TIME_ONLY",
        maxBodyLength: CHANNEL_META.SMS.maxBodyLength,
      }),
    ).toEqual({ ok: false, error: "TOO_LONG" });
  });

  it("recusa modelo vazio", () => {
    expect(renderTemplate("   ", context, permissive)).toEqual({
      ok: false,
      error: "EMPTY",
    });
  });
});

describe("modelos das profissoes", () => {
  it.each(PROFESSION_IDS)(
    "%s tem modelo valido para todo evento permitido",
    (professionId) => {
      const profession = PROFESSION_DEFINITIONS[professionId];
      const { templates, disclosure, allowedEvents, allowedChannels } =
        profession.notifications;

      // O menor limite entre os canais permitidos: um modelo que so cabe no
      // e-mail nao serve para uma profissao que tambem aceita SMS.
      const maxBodyLength = Math.min(
        ...allowedChannels.map((channel) => CHANNEL_META[channel].maxBodyLength),
      );

      for (const event of allowedEvents) {
        const result = renderTemplate(templates[event], context, {
          disclosure,
          maxBodyLength,
        });
        expect(result, `${professionId}/${event}`).toMatchObject({ ok: true });
      }
    },
  );

  it("profissao de dado sensivel nunca nomeia o atendimento", () => {
    for (const professionId of PROFESSION_IDS) {
      const profession = PROFESSION_DEFINITIONS[professionId];
      if (profession.sensitiveDataProfile !== "HIGH") continue;

      expect(profession.notifications.disclosure).toBe("TIME_ONLY");
      for (const event of APPOINTMENT_NOTIFICATION_EVENTS) {
        expect(profession.notifications.templates[event]).not.toContain(
          "{{serviceTerm}}",
        );
      }
    }
  });
});

describe("hashBody", () => {
  it("e estavel e distingue textos diferentes", () => {
    expect(hashBody("mesma coisa")).toBe(hashBody("mesma coisa"));
    expect(hashBody("mesma coisa")).not.toBe(hashBody("outra coisa"));
  });
});
