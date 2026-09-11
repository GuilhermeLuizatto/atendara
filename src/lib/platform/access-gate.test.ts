import { describe, expect, it } from "vitest";

import { GRACE_PERIOD_DAYS } from "@/config/billing";
import { MAX_ACCESS_GRANT_DAYS } from "@/config/platform";

import {
  accessGrantReasonError,
  accessGrantWindowError,
  hasRequiredSecondFactor,
  isGrantInForce,
  resolveAccountGate,
} from "./access-gate";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const iso = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

const grant = (days: number, revokedAt: string | null = null) => ({ until: iso(days), revokedAt });

describe("portao da conta com assinatura e concessao", () => {
  it("sem assinatura e sem concessao a conta fica pendente e fechada", () => {
    expect(resolveAccountGate({ subscription: null, grant: null, nowMs: NOW })).toEqual({
      subscriptionStatus: "PENDING",
      accessUntil: null,
    });
  });

  it("concessao vigente abre o portao ate a propria validade", () => {
    expect(resolveAccountGate({ subscription: null, grant: grant(30), nowMs: NOW })).toEqual({
      subscriptionStatus: "ACTIVE",
      accessUntil: iso(30),
    });
  });

  it("concessao vencida ou revogada nao abre nada", () => {
    expect(isGrantInForce(grant(-1), NOW)).toBe(false);
    expect(isGrantInForce(grant(30, iso(-1)), NOW)).toBe(false);
    expect(resolveAccountGate({ subscription: null, grant: grant(30, iso(0)), nowMs: NOW })).toEqual({
      subscriptionStatus: "PENDING",
      accessUntil: null,
    });
  });

  it("assinatura incompleta nao fecha uma cortesia vigente", () => {
    const gate = resolveAccountGate({
      subscription: { status: "INCOMPLETE", accessUntil: null },
      grant: grant(20),
      nowMs: NOW,
    });
    expect(gate).toEqual({ subscriptionStatus: "ACTIVE", accessUntil: iso(20) });
  });

  it("reembolso integral nao fecha uma concessao vigente", () => {
    const gate = resolveAccountGate({
      // O reembolso grava `accessUntil` no instante do reembolso, ja passado.
      subscription: { status: "PAST_DUE", accessUntil: iso(-0.01) },
      grant: grant(20),
      nowMs: NOW,
    });
    expect(gate).toEqual({ subscriptionStatus: "ACTIVE", accessUntil: iso(20) });
  });

  it("concessao nunca encurta ciclo pago", () => {
    const paid = { status: "ACTIVE" as const, accessUntil: iso(30 + GRACE_PERIOD_DAYS) };
    expect(resolveAccountGate({ subscription: paid, grant: grant(10), nowMs: NOW })).toEqual({
      subscriptionStatus: "ACTIVE",
      accessUntil: paid.accessUntil,
    });
  });

  it("concessao mais longa que o ciclo pago prevalece enquanto vigente", () => {
    const paid = { status: "ACTIVE" as const, accessUntil: iso(5) };
    expect(resolveAccountGate({ subscription: paid, grant: grant(40), nowMs: NOW })).toEqual({
      subscriptionStatus: "ACTIVE",
      accessUntil: iso(40),
    });
  });

  it("sem concessao, cancelamento continua valendo como o gateway decidiu", () => {
    expect(
      resolveAccountGate({ subscription: { status: "CANCELED", accessUntil: iso(3) }, grant: null, nowMs: NOW }),
    ).toEqual({ subscriptionStatus: "CANCELLED", accessUntil: iso(3) });
  });
});

describe("limites da concessao", () => {
  it("recusa validade passada e acima do prazo maximo", () => {
    expect(accessGrantWindowError(iso(-1), NOW)).toMatch(/futura/);
    expect(accessGrantWindowError(iso(MAX_ACCESS_GRANT_DAYS + 0.001), NOW)).toMatch(/maximo/);
    expect(accessGrantWindowError(iso(MAX_ACCESS_GRANT_DAYS), NOW)).toBeNull();
    expect(accessGrantWindowError("nao-e-data", NOW)).toMatch(/futura/);
  });

  it("exige motivo escrito", () => {
    expect(accessGrantReasonError("   curto  ")).not.toBeNull();
    expect(accessGrantReasonError("Piloto combinado em reuniao de 10/09.")).toBeNull();
    expect(accessGrantReasonError("x".repeat(501))).not.toBeNull();
  });
});

describe("segundo fator da operadora", () => {
  it("aceita somente TOTP declarado no token", () => {
    expect(hasRequiredSecondFactor({ firebase: { sign_in_second_factor: "totp" } })).toBe(true);
    expect(hasRequiredSecondFactor({ firebase: { sign_in_second_factor: "phone" } })).toBe(false);
    expect(hasRequiredSecondFactor({ firebase: { sign_in_provider: "password" } })).toBe(false);
    expect(hasRequiredSecondFactor({})).toBe(false);
    expect(hasRequiredSecondFactor(null)).toBe(false);
    expect(hasRequiredSecondFactor({ firebase: "totp" })).toBe(false);
  });
});
