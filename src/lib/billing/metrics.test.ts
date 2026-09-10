import { describe, expect, it } from "vitest";

import type { PlatformInvoice, PlatformSubscription } from "@/types";

import { computePlatformMetrics, monthlyEquivalentInCents } from "./metrics";

function subscription(
  overrides: Partial<PlatformSubscription> & Pick<PlatformSubscription, "organizationId">,
): PlatformSubscription {
  return {
    subscriberUserId: "usuario",
    subscriberEmail: "assinante@exemplo.test",
    planId: "profissional-mensal",
    status: "ACTIVE",
    amountInCents: 19_900,
    currency: "BRL",
    interval: "MONTH",
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    accessUntil: "2026-10-06T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    canceledAt: null,
    gateway: { provider: "STRIPE", customerId: "cus_1", subscriptionId: "sub_1" },
    lastEventAt: null,
    lastEventId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function invoice(overrides: Partial<PlatformInvoice> & Pick<PlatformInvoice, "id">): PlatformInvoice {
  return {
    organizationId: "org-a",
    subscriptionId: "sub_1",
    planId: "profissional-mensal",
    status: "PAID",
    amountDueInCents: 19_900,
    amountPaidInCents: 19_900,
    amountRefundedInCents: 0,
    currency: "BRL",
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-10-01T00:00:00.000Z",
    issuedAt: "2026-09-01T00:00:00.000Z",
    paidAt: "2026-09-01T00:00:00.000Z",
    hostedInvoiceUrl: null,
    gatewayInvoiceId: overrides.id,
    lastEventAt: null,
    lastEventId: null,
    ...overrides,
  };
}

describe("Indicadores da plataforma", () => {
  it("normaliza o plano anual dividindo por doze", () => {
    expect(monthlyEquivalentInCents(19_900, "MONTH")).toBe(19_900);
    expect(monthlyEquivalentInCents(199_000, "YEAR")).toBe(16_583);
  });

  it("receita recorrente conta so o que esta sendo pago hoje", () => {
    const metrics = computePlatformMetrics(
      [
        subscription({ organizationId: "org-a" }),
        subscription({ organizationId: "org-b", interval: "YEAR", amountInCents: 199_000 }),
        // Teste ainda nao pagou; inadimplente falhou a cobranca do ciclo.
        subscription({ organizationId: "org-c", status: "TRIALING" }),
        subscription({ organizationId: "org-d", status: "PAST_DUE" }),
        subscription({ organizationId: "org-e", status: "CANCELED" }),
      ],
      [],
    );

    expect(metrics.monthlyRecurringRevenueInCents).toBe(19_900 + 16_583);
    expect(metrics.annualRunRateInCents).toBe((19_900 + 16_583) * 12);
    expect(metrics.activeSubscriptions).toBe(2);
    expect(metrics.trialingSubscriptions).toBe(1);
    expect(metrics.delinquentSubscriptions).toBe(1);
    expect(metrics.canceledSubscriptions).toBe(1);
    expect(metrics.churnRate).toBeCloseTo(1 / 5);
  });

  it("em aberto soma o que falta receber; recebido desconta o reembolso", () => {
    const metrics = computePlatformMetrics(
      [subscription({ organizationId: "org-a" })],
      [
        invoice({ id: "in_1" }),
        invoice({ id: "in_2", status: "OPEN", amountPaidInCents: 0 }),
        invoice({ id: "in_3", status: "PAST_DUE", amountPaidInCents: 0 }),
        invoice({ id: "in_4", status: "REFUNDED", amountRefundedInCents: 19_900 }),
        // Cancelada nao e "a receber": ninguem vai cobrar essa.
        invoice({ id: "in_5", status: "VOID", amountPaidInCents: 0 }),
      ],
    );

    expect(metrics.outstandingInCents).toBe(19_900 * 2);
    expect(metrics.refundedInCents).toBe(19_900);
    expect(metrics.netCollectedInCents).toBe(19_900 * 2 - 19_900);
  });

  it("base vazia devolve zero em vez de dividir por zero", () => {
    const metrics = computePlatformMetrics([], []);
    expect(metrics.churnRate).toBe(0);
    expect(metrics.monthlyRecurringRevenueInCents).toBe(0);
  });
});
