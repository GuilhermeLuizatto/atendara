import { describe, expect, it } from "vitest";

import { MAX_ACCESS_GRANT_DAYS, TRIAL_DAYS } from "@/config/platform";
import { listAllProfessions, listProfessions } from "@/config/professions";
import { APP_MODULES } from "@/types/access";

import {
  councilRegistrationError,
  selfServiceModules,
  trialUntil,
} from "./self-service";

const DAY_MS = 86_400_000;

describe("cadastro aberto", () => {
  it("pede registro de quem tem conselho e recusa de quem nao tem", () => {
    for (const profession of listAllProfessions()) {
      const semRegistro = councilRegistrationError(profession.id, null);
      const comRegistro = councilRegistrationError(profession.id, "CRP 06/123456");

      if (profession.council) {
        expect(semRegistro).toContain(profession.council.acronym);
        expect(comRegistro).toBeNull();
      } else {
        expect(semRegistro).toBeNull();
        // Mandar registro a quem nao tem conselho e tela fora de sincronia com
        // a tabela: recusar aqui evita gravar um dado que nao significa nada.
        expect(comRegistro).not.toBeNull();
      }
    }
  });

  it("recusa registro colado errado, sem tentar julgar se ele existe", () => {
    const comConselho = listProfessions().find((profession) => profession.council)!;
    for (const invalido of ["12", "<script>alert(1)</script>", "CRP@06", "CRP 06/1234567890123456789"]) {
      expect(councilRegistrationError(comConselho.id, invalido)).not.toBeNull();
    }
    // Formatos que os conselhos realmente usam continuam passando.
    for (const valido of ["123456", "06/123456", "CRP-06/123456", "CRM 12.345"]) {
      expect(councilRegistrationError(comConselho.id, valido)).toBeNull();
    }
  });

  it("abre todas as areas no teste", () => {
    expect(selfServiceModules()).toEqual([...APP_MODULES]);
    // Copia, e nao a mesma instancia: uma conta nao pode alterar a lista de outra.
    expect(selfServiceModules()).not.toBe(selfServiceModules());
  });

  it("termina o teste dentro da janela maxima de uma concessao", () => {
    const now = Date.parse("2026-09-16T12:00:00.000Z");
    expect(trialUntil(now)).toBe(new Date(now + TRIAL_DAYS * DAY_MS).toISOString());
    // A trava que sustenta a regra 10: o teste nao e uma terceira porta, e uma
    // concessao registrada — e precisa caber na janela delas.
    expect(TRIAL_DAYS).toBeLessThanOrEqual(MAX_ACCESS_GRANT_DAYS);
  });
});
