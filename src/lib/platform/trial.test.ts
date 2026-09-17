import { describe, expect, it } from "vitest";

import { BLOCKED_RETENTION_DAYS, TRIAL_DAYS, TRIAL_ENDING_NOTICE_DAYS } from "@/config/platform";

import { trialState } from "./trial";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const emDias = (dias: number) => new Date(NOW + dias * DAY).toISOString();

const conta = (extra: Record<string, unknown> = {}) =>
  ({
    origin: "SELF_SERVICE" as const,
    accessUntil: emDias(TRIAL_DAYS),
    blockedSince: null,
    ...extra,
  }) as Parameters<typeof trialState>[0];

describe("estado do teste de 14 dias", () => {
  it("ignora quem nao veio do cadastro aberto e quem ainda nao confirmou o e-mail", () => {
    expect(trialState(null, NOW).phase).toBe("NONE");
    expect(trialState(conta({ origin: "OPERATOR" }), NOW).phase).toBe("NONE");
    // Cadastrada, e-mail nao confirmado: nao ha concessao, entao nao ha teste.
    expect(trialState(conta({ accessUntil: null }), NOW).phase).toBe("NONE");
    expect(trialState(conta({ accessUntil: "nao e data" }), NOW).phase).toBe("NONE");
  });

  it("avisa so nos ultimos dias, e conta dias inteiros", () => {
    expect(trialState(conta(), NOW)).toMatchObject({ phase: "RUNNING", daysLeft: TRIAL_DAYS });
    expect(trialState(conta({ accessUntil: emDias(TRIAL_ENDING_NOTICE_DAYS + 1) }), NOW).phase).toBe("RUNNING");
    expect(trialState(conta({ accessUntil: emDias(TRIAL_ENDING_NOTICE_DAYS) }), NOW)).toMatchObject({
      phase: "ENDING",
      daysLeft: TRIAL_ENDING_NOTICE_DAYS,
    });
    // Faltando poucas horas ainda e um dia: arredondar para baixo diria "0 dias"
    // para quem ainda tem a tarde inteira.
    expect(trialState(conta({ accessUntil: new Date(NOW + 3_600_000).toISOString() }), NOW)).toMatchObject({
      phase: "ENDING",
      daysLeft: 1,
    });
  });

  it("bloqueia no instante em que a validade passa", () => {
    expect(trialState(conta({ accessUntil: new Date(NOW + 1000).toISOString() }), NOW).phase).toBe("ENDING");
    expect(trialState(conta({ accessUntil: new Date(NOW).toISOString() }), NOW)).toMatchObject({
      phase: "BLOCKED",
      daysLeft: 0,
    });
  });

  it("conta a retencao do vencimento quando a rotina ainda nao passou", () => {
    const vencida = conta({ accessUntil: emDias(-2) });
    // Sem `blockedSince`, o prazo corre desde o vencimento: uma rotina atrasada
    // nao pode esticar a guarda de quem ja foi bloqueado.
    expect(trialState(vencida, NOW).daysUntilErasure).toBe(BLOCKED_RETENTION_DAYS - 2);
    expect(trialState(conta({ accessUntil: emDias(-2), blockedSince: emDias(-1) }), NOW).daysUntilErasure).toBe(
      BLOCKED_RETENTION_DAYS - 1,
    );
    // Passado o prazo, nunca negativo.
    expect(
      trialState(conta({ accessUntil: emDias(-90), blockedSince: emDias(-90) }), NOW).daysUntilErasure,
    ).toBe(0);
  });
});

describe("depois da assinatura (A.6)", () => {
  it("quem assinou nao esta mais em teste, nem avisado, nem bloqueado", () => {
    const assinou = { subscribedAt: "2026-09-10T10:00:00.000Z" };
    expect(trialState(conta({ ...assinou, accessUntil: emDias(2) }), NOW).phase).toBe("NONE");
    expect(trialState(conta({ ...assinou, accessUntil: emDias(-5) }), NOW).phase).toBe("NONE");
  });
});
