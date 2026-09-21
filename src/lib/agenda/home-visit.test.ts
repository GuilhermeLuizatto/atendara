import { describe, expect, it } from "vitest";

import { HOME_VISIT_ERRORS, HOME_VISIT_LIMITS } from "@/config/home-visit";
import { renderTemplate } from "@/lib/notifications/templates";

import { validateHomeVisit } from "./home-visit";

const ENDERECO = "Rua das Flores, 100, apto 2";

function entrada(patch: Partial<Parameters<typeof validateHomeVisit>[0]> = {}) {
  return validateHomeVisit({
    modality: "HOME_VISIT",
    visitAddress: ENDERECO,
    travelFeeInCents: 3000,
    available: true,
    ...patch,
  });
}

describe("endereco e taxa do atendimento a domicilio", () => {
  it("aceita endereco e taxa, tirando espaco sobrando", () => {
    expect(entrada({ visitAddress: `  ${ENDERECO}  ` })).toEqual({
      ok: true,
      value: { visitAddress: ENDERECO, travelFeeInCents: 3000 },
    });
  });

  it("atendimento sem endereco e sem taxa passa em qualquer profissao", () => {
    expect(entrada({ visitAddress: null, travelFeeInCents: null, available: false, modality: "IN_PERSON" })).toEqual({
      ok: true,
      value: { visitAddress: null, travelFeeInCents: null },
    });
  });

  // O endereco pertence ao domicilio. Guardar num presencial espalharia dado
  // pessoal por registro que nao precisa dele.
  it("recusa endereco em atendimento presencial", () => {
    expect(entrada({ modality: "IN_PERSON" })).toEqual({
      ok: false,
      error: HOME_VISIT_ERRORS.MODALITY_MISMATCH,
    });
  });

  it("recusa taxa sem atendimento a domicilio", () => {
    expect(entrada({ modality: "IN_PERSON", visitAddress: null })).toEqual({
      ok: false,
      error: HOME_VISIT_ERRORS.TRAVEL_FEE_WITHOUT_VISIT,
    });
  });

  it("recusa a profissao que nao registra domicilio", () => {
    expect(entrada({ available: false })).toEqual({
      ok: false,
      error: HOME_VISIT_ERRORS.NOT_AVAILABLE,
    });
  });

  it("recusa endereco curto demais e longo demais", () => {
    expect(entrada({ visitAddress: "Rua A" })).toEqual({
      ok: false,
      error: HOME_VISIT_ERRORS.ADDRESS_TOO_SHORT,
    });
    expect(entrada({ visitAddress: "R".repeat(HOME_VISIT_LIMITS.address.max + 1) })).toEqual({
      ok: false,
      error: HOME_VISIT_ERRORS.ADDRESS_TOO_LONG,
    });
  });

  it("recusa taxa negativa e centavo quebrado", () => {
    expect(entrada({ travelFeeInCents: -1 })).toEqual({
      ok: false,
      error: HOME_VISIT_ERRORS.TRAVEL_FEE_RANGE,
    });
    expect(entrada({ travelFeeInCents: 30.5 })).toEqual({
      ok: false,
      error: HOME_VISIT_ERRORS.TRAVEL_FEE_RANGE,
    });
  });

  it("taxa zero e o mesmo que nao cobrar deslocamento", () => {
    expect(entrada({ travelFeeInCents: 0 })).toEqual({
      ok: true,
      value: { visitAddress: ENDERECO, travelFeeInCents: null },
    });
  });
});

/**
 * A trava que mais importa da E2.3: o endereco nao sai do painel.
 *
 * Nao depende de ninguem lembrar disso ao escrever um modelo — o interpolador
 * so conhece as variaveis de `TemplateContext`, e endereco nao e uma delas.
 */
describe("o endereco nao chega ao aviso", () => {
  const contexto = {
    clientName: "Alex Fictício",
    organizationName: "Estúdio Fictício",
    professionalName: "Sam Fictício",
    serviceTerm: "atendimento",
    date: "25/09",
    time: "10:00",
  };

  it("modelo que tenta interpolar o endereco e recusado", () => {
    const resultado = renderTemplate(
      "Olá, {{clientName}}. Vou até {{visitAddress}} às {{time}}.",
      contexto,
      { disclosure: "TIME_PROFESSIONAL_AND_SERVICE", maxBodyLength: 400 },
    );

    expect(resultado.ok).toBe(false);
  });
});
