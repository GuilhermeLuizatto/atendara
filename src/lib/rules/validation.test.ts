import { describe, expect, it } from "vitest";
import { interpretRuleText } from "./natural-language";
import { validateRuleInput } from "./validation";

function input() {
  const draft = interpretRuleText(
    "O agente pode informar que a consulta custa R$ 180 e dura 50 minutos.",
  );
  return {
    ...draft,
    level: "PROFESSIONAL",
    priority: 100,
    enabled: false,
    source: "NATURAL_LANGUAGE",
    naturalLanguageInput: draft.sourceText,
    professionalId: null,
  };
}

describe("regras estruturadas", () => {
  it("extrai centavos e duracao de texto livre", () => {
    expect(input().actions[0].payload).toMatchObject({
      priceInCents: 18000,
      durationMinutes: 50,
    });
    expect(validateRuleInput(input()).valid).toBe(true);
  });
  it("preserva centavos brasileiros", () => {
    expect(
      interpretRuleText("Informar preco de R$ 1.234,56").actions[0].payload
        ?.priceInCents,
    ).toBe(123456);
  });
  it("interpreta negacao, modalidade e dia", () => {
    const draft = interpretRuleText("Nao informar o preco online no domingo.");
    expect(draft.actions[0].type).toBe("DENY_TOPIC");
    expect(draft.conditions.conditions).toContainEqual({
      field: "context.dayOfWeek",
      operator: "EQUALS",
      value: 0,
    });
    expect(draft.conditions.conditions).toContainEqual({
      field: "client.modality",
      operator: "EQUALS",
      value: "ONLINE",
    });
  });
  it("distingue remarcar de marcar e sinaliza texto nao reconhecido", () => {
    expect(
      interpretRuleText("O agente pode remarcar consultas.").category,
    ).toBe("RESCHEDULING");
    expect(interpretRuleText("Abacaxi").warnings.length).toBeGreaterThan(0);
  });
  it.each(["SECURITY", "SYSTEM", "PROFESSION"])(
    "recusa nivel reservado %s",
    (level) => {
      expect(validateRuleInput({ ...input(), level }).valid).toBe(false);
    },
  );
  it("recusa acoes de sistema, fonte forjada, centavos fracionados e contexto vazio", () => {
    expect(
      validateRuleInput({
        ...input(),
        actions: [{ type: "BLOCK", payload: null }],
      }).valid,
    ).toBe(false);
    expect(validateRuleInput({ ...input(), source: "SYSTEM" }).valid).toBe(
      false,
    );
    expect(
      validateRuleInput({
        ...input(),
        actions: [{ type: "ALLOW_TOPIC", payload: { priceInCents: 10.5 } }],
      }).valid,
    ).toBe(false);
    expect(
      validateRuleInput({
        ...input(),
        level: "CONTEXTUAL",
        conditions: { combinator: "AND", conditions: [] },
      }).valid,
    ).toBe(false);
  });
});
