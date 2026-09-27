import { describe, expect, it } from "vitest";
import { listAllProfessions } from "@/config/professions";
import { buildMockDataset } from "@/mocks";
import type { AIRule } from "@/types";
import type { AdminIntent } from "./classify";
import { composeResponse, INTENT_TO_CATEGORY } from "./responses";

const now = new Date("2026-09-26T15:00:00Z");
const intents = Object.keys(INTENT_TO_CATEGORY) as AdminIntent[];

/** Regra com preço e duração explícitos: a Estética não tem valor padrão. */
function rule(base: AIRule): AIRule {
  return {
    ...base,
    actions: [
      { type: "PROVIDE_INFO", payload: { priceInCents: 20000, durationMinutes: 50 } },
    ],
  };
}

describe("resposta automática da Dara", () => {
  it("concorda com o termo da profissão", () => {
    const data = buildMockDataset("PSYCHOLOGIST", now);
    const text = composeResponse("PRICING", {
      profession: listAllProfessions().find((p) => p.id === "PSYCHOLOGIST")!,
      organization: data.organization,
      rule: rule(data.rules[0]),
    });
    expect(text).toContain("O valor da sessão é");
  });

  // Validação real de 26/09: "O valor do sessão". Sete das nove profissões têm
  // termo feminino, e o erro saía em toda intenção que cita o termo.
  it.each(listAllProfessions().map((profession) => [profession.id, profession] as const))(
    "não erra artigo nem contração em %s",
    (_, profession) => {
      const data = buildMockDataset(profession.id, now);
      const { appointment, professional } = profession.terminology;
      for (const intent of intents) {
        const text = composeResponse(intent, {
          profession,
          organization: data.organization,
          rule: rule(data.rules[0]),
        });
        if (text === null) continue;
        const wrongAppointment = appointment.feminine
          ? ["do", "o", "pelo", "no"]
          : ["da", "a", "pela", "na"];
        const wrongProfessional = professional.feminine
          ? ["do", "o", "pelo", "O"]
          : ["da", "a", "pela", "A"];
        for (const article of wrongAppointment) {
          expect(text).not.toMatch(new RegExp(`(^|\\s)${article} ${appointment.singularLower}\\b`, "u"));
        }
        for (const article of wrongProfessional) {
          expect(text).not.toMatch(new RegExp(`(^|\\s)${article} ${professional.singularLower}\\b`, "u"));
        }
      }
    },
  );
});
