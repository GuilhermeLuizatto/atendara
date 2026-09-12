import { describe, expect, it } from "vitest";

import { getProfession, listProfessions } from "@/config/professions";

import { allTerm, firstTerm, newTerm, nextPluralTerm, noTerm } from "./terms";

describe("concordancia com o termo da profissao", () => {
  it("flexiona artigo e adjetivo pelo genero do termo", () => {
    const psychologist = getProfession("PSYCHOLOGIST").terminology;
    expect(newTerm(psychologist.appointment)).toBe("Nova sessão");
    expect(noTerm(psychologist.appointment)).toBe("Nenhuma sessão");
    expect(nextPluralTerm(psychologist.appointment)).toBe("Próximas sessões");
    expect(allTerm(psychologist.appointment)).toBe("todas as sessões");
    expect(firstTerm(psychologist.client)).toBe("o primeiro paciente");

    const trainer = getProfession("PERSONAL_TRAINER").terminology;
    expect(newTerm(trainer.appointment)).toBe("Novo treino");
    expect(firstTerm(trainer.appointment)).toBe("o primeiro treino");
  });

  it("toda profissao declara o genero dos tres termos", () => {
    for (const profession of listProfessions()) {
      for (const pair of Object.values(profession.terminology)) {
        expect(typeof pair.feminine).toBe("boolean");
      }
    }
  });
});
