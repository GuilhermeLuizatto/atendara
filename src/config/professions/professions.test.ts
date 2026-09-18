import { describe, expect, it } from "vitest";

import { CLASSIFICATION_META } from "@/config/classifications";
import { PROFESSION_IDS, type MessageClassificationId } from "@/types";

import {
  getProfession,
  isProfessionId,
  listAllProfessions,
  listProfessions,
  resolveProfession,
} from ".";

/**
 * O registry de profissoes e o que sustenta a promessa de plataforma
 * horizontal. Estes testes garantem que uma profissao nova nao entra no sistema
 * incompleta — o que apareceria como interface quebrada, e nao como erro.
 */
describe("registry de profissoes", () => {
  it("tem configuracao para toda profissao declarada", () => {
    expect(listAllProfessions()).toHaveLength(PROFESSION_IDS.length);
    for (const id of PROFESSION_IDS) {
      expect(getProfession(id).id).toBe(id);
    }
  });

  it("preenche as quatro formas de cada termo", () => {
    for (const profession of listAllProfessions()) {
      for (const term of Object.values(profession.terminology)) {
        expect(term.singular.length).toBeGreaterThan(0);
        expect(term.plural.length).toBeGreaterThan(0);
        expect(term.singularLower).toBe(
          term.singular.toLocaleLowerCase("pt-BR"),
        );
        expect(term.pluralLower).toBe(term.plural.toLocaleLowerCase("pt-BR"));
      }
    }
  });

  it("sempre inclui as classificacoes obrigatorias", () => {
    const required: MessageClassificationId[] = [
      "ADMINISTRATIVE",
      "POSSIBLE_RISK",
      "UNKNOWN",
    ];

    for (const profession of listAllProfessions()) {
      for (const classification of required) {
        expect(profession.messageClassifications).toContain(classification);
      }
    }
  });

  it("usa apenas classificacoes que existem na taxonomia", () => {
    for (const profession of listAllProfessions()) {
      for (const classification of profession.messageClassifications) {
        expect(CLASSIFICATION_META[classification]).toBeDefined();
      }
    }
  });

  it("habilita exatamente uma classificacao com resposta automatica", () => {
    // Trava central do produto: so o administrativo pode ser respondido pelo
    // agente. Se uma profissao nova habilitar outra classificacao elegivel,
    // este teste falha antes de o comportamento chegar ao usuario.
    for (const profession of listAllProfessions()) {
      const eligible = profession.messageClassifications.filter(
        (id) => CLASSIFICATION_META[id].autoResponseEligible,
      );
      expect(eligible).toEqual(["ADMINISTRATIVE"]);
    }
  });

  it("define ao menos uma modalidade e valores plausiveis", () => {
    for (const profession of listAllProfessions()) {
      expect(profession.modalities.length).toBeGreaterThan(0);
      // `null` significa "a profissional define"; zero nunca e padrao.
      const duration = profession.defaultAppointmentDurationMinutes ?? 1;
      const price = profession.defaultPriceInCents ?? 1;
      expect(duration).toBeGreaterThan(0);
      expect(price).toBeGreaterThan(0);
      // Valores em centavos: um preco inteiro nunca teria fracao.
      expect(Number.isInteger(price)).toBe(true);
    }
  });

  it("diz o conselho de cada profissao, ou que nao ha", () => {
    for (const profession of listAllProfessions()) {
      if (profession.council === null) continue;
      // Sigla como aparece no formulario: so maiusculas, sem espaco.
      expect(profession.council.acronym).toMatch(/^[A-Z]{3,8}$/);
      expect(profession.council.name.length).toBeGreaterThan(10);
    }
  });

  it("estetica nao pede registro de conselho", () => {
    expect(getProfession("AESTHETICS").council).toBeNull();
  });

  it("deixa preco e duracao da estetica com a profissional", () => {
    const aesthetics = getProfession("AESTHETICS");
    expect(aesthetics.defaultPriceInCents).toBeNull();
    expect(aesthetics.defaultAppointmentDurationMinutes).toBeNull();
  });

  it("traz regras sugeridas com pelo menos uma trava de seguranca", () => {
    for (const profession of listAllProfessions()) {
      expect(profession.suggestedRules.length).toBeGreaterThan(0);
      const hasSafety = profession.suggestedRules.some(
        (rule) => rule.category === "SAFETY" || rule.category === "ESCALATION",
      );
      expect(hasSafety).toBe(true);
    }
  });

  it("esconde da vitrine quem nao esta listado, sem tirar do produto", () => {
    const visiveis = listProfessions();
    const escondidas = listAllProfessions().filter(
      (profession) => !profession.listed,
    );

    expect(escondidas.map((profession) => profession.id)).toContain(
      "THERAPIST",
    );
    for (const profession of escondidas) {
      expect(visiveis).not.toContain(profession);
      // Some da lista, continua valendo para quem ja a usa.
      expect(getProfession(profession.id).id).toBe(profession.id);
      expect(resolveProfession(profession.id).id).toBe(profession.id);
    }
    expect(visiveis.length).toBe(listAllProfessions().length - escondidas.length);
  });

  it("resolve valor nao confiavel para o padrao, sem lancar", () => {
    expect(isProfessionId("PSYCHOLOGIST")).toBe(true);
    expect(isProfessionId("ASTRONAUTA")).toBe(false);
    expect(resolveProfession(null).id).toBe("PSYCHOLOGIST");
    expect(resolveProfession("<script>").id).toBe("PSYCHOLOGIST");
    expect(resolveProfession("DENTIST").id).toBe("DENTIST");
  });
});
