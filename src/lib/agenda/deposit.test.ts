import { describe, expect, it } from "vitest";

import { DEPOSIT_ERRORS } from "@/config/deposit";

import {
  asksAboutDeposit,
  depositDueDate,
  serviceAmountFor,
  settleDeposit,
  validateDeposit,
} from "./deposit";

describe("validacao do sinal", () => {
  it("sem sinal e sinal zero sao a mesma coisa", () => {
    expect(validateDeposit({ depositInCents: null, priceInCents: 20000, available: true })).toEqual({ ok: true, value: null });
    expect(validateDeposit({ depositInCents: 0, priceInCents: 20000, available: true })).toEqual({ ok: true, value: null });
  });

  it("aceita o sinal dentro do valor do atendimento", () => {
    expect(validateDeposit({ depositInCents: 5000, priceInCents: 20000, available: true })).toEqual({ ok: true, value: 5000 });
    // O valor inteiro como sinal e pagamento antecipado, e vale.
    expect(validateDeposit({ depositInCents: 20000, priceInCents: 20000, available: true })).toEqual({ ok: true, value: 20000 });
  });

  // Sinal maior que o valor deixaria a receita do servico negativa.
  it("recusa sinal maior que o valor, e valor ausente", () => {
    expect(validateDeposit({ depositInCents: 25000, priceInCents: 20000, available: true })).toEqual({
      ok: false,
      error: DEPOSIT_ERRORS.OVER_PRICE,
    });
    expect(validateDeposit({ depositInCents: 5000, priceInCents: 0, available: true })).toEqual({
      ok: false,
      error: DEPOSIT_ERRORS.NO_PRICE,
    });
  });

  it("recusa centavo quebrado e profissao que nao trabalha com sinal", () => {
    expect(validateDeposit({ depositInCents: 50.5, priceInCents: 20000, available: true })).toEqual({
      ok: false,
      error: DEPOSIT_ERRORS.NOT_INTEGER,
    });
    expect(validateDeposit({ depositInCents: 5000, priceInCents: 20000, available: false })).toEqual({
      ok: false,
      error: DEPOSIT_ERRORS.NOT_AVAILABLE,
    });
  });

  it("a profissao sem sinal ainda pode marcar atendimento sem sinal", () => {
    expect(validateDeposit({ depositInCents: null, priceInCents: 20000, available: false })).toEqual({ ok: true, value: null });
  });
});

describe("o sinal abate", () => {
  it("R$ 200 com sinal de R$ 50 deixa R$ 150 a pagar", () => {
    expect(serviceAmountFor(20000, 5000)).toBe(15000);
  });

  it("sem sinal, fica o valor cheio; sinal do valor inteiro nao deixa nada", () => {
    expect(serviceAmountFor(20000, null)).toBe(20000);
    expect(serviceAmountFor(20000, 20000)).toBe(0);
  });
});

describe("quando o sinal vence", () => {
  const AGORA = "2026-09-20T12:00:00.000Z";

  // Sem prazo, o sinal nasceria vencido e a tela diria "em atraso" na hora.
  it("da 24 horas quando o atendimento esta longe", () => {
    expect(depositDueDate(AGORA, "2026-10-01T12:00:00.000Z")).toBe("2026-09-21T12:00:00.000Z");
  });

  it("nunca vence depois do proprio atendimento", () => {
    expect(depositDueDate(AGORA, "2026-09-20T15:00:00.000Z")).toBe("2026-09-20T15:00:00.000Z");
  });
});

describe("destino do sinal quando o atendimento muda", () => {
  it("cancelamento sem sinal derruba so a receita, como sempre", () => {
    expect(settleDeposit({ status: "CANCELLED", hasDeposit: false, depositPaid: false, choice: null })).toEqual({
      deposit: "UNCHANGED",
      service: "CANCEL",
      outcome: null,
    });
  });

  it("cancelamento retem por padrao e devolve quando ela escolhe", () => {
    const base = { status: "CANCELLED" as const, hasDeposit: true, depositPaid: true };

    expect(settleDeposit({ ...base, choice: null })).toEqual({ deposit: "KEEP_PAID", service: "CANCEL", outcome: "KEPT" });
    expect(settleDeposit({ ...base, choice: "KEEP" })).toEqual({ deposit: "KEEP_PAID", service: "CANCEL", outcome: "KEPT" });
    expect(settleDeposit({ ...base, choice: "REFUND" })).toEqual({ deposit: "REFUND", service: "CANCEL", outcome: "REFUNDED" });
  });

  // Nao ha o que reter de um sinal que nunca foi pago.
  it("sinal nao pago cai junto no cancelamento, mesmo pedindo para reter", () => {
    expect(settleDeposit({ status: "CANCELLED", hasDeposit: true, depositPaid: false, choice: "KEEP" })).toEqual({
      deposit: "CANCEL",
      service: "CANCEL",
      outcome: null,
    });
  });

  it("falta sem aviso retem o sinal pago e derruba o que ficou a pagar", () => {
    expect(settleDeposit({ status: "NO_SHOW", hasDeposit: true, depositPaid: true, choice: null })).toEqual({
      deposit: "KEEP_PAID",
      service: "CANCEL",
      outcome: "KEPT",
    });
  });

  // Sem sinal, a falta continua como era antes da E2.2: a cobranca fica de pe.
  it("falta sem aviso e sem sinal nao mexe em lancamento nenhum", () => {
    expect(settleDeposit({ status: "NO_SHOW", hasDeposit: false, depositPaid: false, choice: null })).toEqual({
      deposit: "UNCHANGED",
      service: "UNCHANGED",
      outcome: null,
    });
  });

  it("confirmar e realizar nao mexem no sinal", () => {
    for (const status of ["CONFIRMED", "COMPLETED", "SCHEDULED", "RESCHEDULED"] as const) {
      expect(settleDeposit({ status, hasDeposit: true, depositPaid: true, choice: "REFUND" })).toEqual({
        deposit: "UNCHANGED",
        service: "UNCHANGED",
        outcome: null,
      });
    }
  });
});

describe("quando a tela pergunta", () => {
  it("so pergunta no cancelamento com sinal ja pago", () => {
    expect(asksAboutDeposit({ status: "CANCELLED", hasDeposit: true, depositPaid: true })).toBe(true);
    expect(asksAboutDeposit({ status: "CANCELLED", hasDeposit: true, depositPaid: false })).toBe(false);
    expect(asksAboutDeposit({ status: "NO_SHOW", hasDeposit: true, depositPaid: true })).toBe(false);
  });
});
