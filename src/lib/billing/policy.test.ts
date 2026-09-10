import { describe, expect, it } from "vitest";

import { GRACE_PERIOD_DAYS } from "@/config/billing";

import {
  computeAccessUntil,
  fromUnixSeconds,
  isFullRefund,
  isOutOfOrder,
  toAccountSubscriptionStatus,
  toPlatformStatus,
} from "./policy";

const PERIOD_END = "2026-10-09T12:00:00.000Z";
const day = 86_400_000;

describe("Politica de acesso a partir da cobranca", () => {
  it("traduz os estados do gateway sem inventar um estado permissivo", () => {
    expect(toPlatformStatus("active")).toBe("ACTIVE");
    expect(toPlatformStatus("trialing")).toBe("TRIALING");
    expect(toPlatformStatus("past_due")).toBe("PAST_DUE");
    expect(toPlatformStatus("canceled")).toBe("CANCELED");
    expect(toPlatformStatus("incomplete_expired")).toBe("UNPAID");
    // Estado desconhecido nao pode virar acesso liberado por descuido.
    expect(toPlatformStatus("um_estado_que_ainda_nao_existe")).toBe("INCOMPLETE");
    expect(toAccountSubscriptionStatus(toPlatformStatus("um_estado_novo"))).toBe("PENDING");
  });

  it("assinatura vigente e inadimplente recente recebem a tolerancia", () => {
    const esperado = new Date(Date.parse(PERIOD_END) + GRACE_PERIOD_DAYS * day).toISOString();

    for (const status of ["ACTIVE", "TRIALING", "PAST_DUE"] as const) {
      expect(computeAccessUntil({ status, currentPeriodEnd: PERIOD_END })).toBe(esperado);
    }
  });

  it("cancelamento e inadimplencia terminal param no fim do ciclo pago", () => {
    for (const status of ["CANCELED", "UNPAID"] as const) {
      expect(computeAccessUntil({ status, currentPeriodEnd: PERIOD_END })).toBe(PERIOD_END);
    }
  });

  it("assinatura sem pagamento confirmado nao concede acesso nenhum", () => {
    // Voltar do checkout deixa a assinatura em INCOMPLETE. Nem com um ciclo
    // declarado ela abre o painel — e a trava de "retorno nao e pagamento".
    expect(computeAccessUntil({ status: "INCOMPLETE", currentPeriodEnd: PERIOD_END })).toBeNull();
    expect(computeAccessUntil({ status: "ACTIVE", currentPeriodEnd: null })).toBeNull();
  });

  it("traduz para o portao que as Security Rules leem", () => {
    expect(toAccountSubscriptionStatus("ACTIVE")).toBe("ACTIVE");
    expect(toAccountSubscriptionStatus("TRIALING")).toBe("ACTIVE");
    expect(toAccountSubscriptionStatus("PAST_DUE")).toBe("PENDING");
    expect(toAccountSubscriptionStatus("INCOMPLETE")).toBe("PENDING");
    expect(toAccountSubscriptionStatus("CANCELED")).toBe("CANCELLED");
    expect(toAccountSubscriptionStatus("UNPAID")).toBe("CANCELLED");
  });

  it("reembolso integral e reconhecido; parcial nao", () => {
    expect(isFullRefund(19_900, 19_900)).toBe(true);
    expect(isFullRefund(19_900, 20_000)).toBe(true);
    expect(isFullRefund(19_900, 5_000)).toBe(false);
    // Fatura sem pagamento registrado nao "se reembolsa" sozinha.
    expect(isFullRefund(0, 0)).toBe(false);
  });

  it("descarta evento anterior ao ultimo aplicado e aceita empate", () => {
    const aplicado = "2026-09-09T12:00:00.000Z";

    expect(isOutOfOrder(aplicado, "2026-09-09T11:59:59.000Z")).toBe(true);
    expect(isOutOfOrder(aplicado, aplicado)).toBe(false);
    expect(isOutOfOrder(aplicado, "2026-09-09T12:00:01.000Z")).toBe(false);
    // Primeiro evento do documento nunca esta fora de ordem.
    expect(isOutOfOrder(null, "2020-01-01T00:00:00.000Z")).toBe(false);
  });

  it("converte o carimbo unix do gateway sem aceitar lixo", () => {
    expect(fromUnixSeconds(1_788_000_000)).toBe(new Date(1_788_000_000_000).toISOString());
    expect(fromUnixSeconds(null)).toBeNull();
    expect(fromUnixSeconds(undefined)).toBeNull();
    expect(fromUnixSeconds(Number.NaN)).toBeNull();
  });
});
