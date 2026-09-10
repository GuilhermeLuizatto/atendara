import type {
  BillingInterval,
  PlatformInvoice,
  PlatformMetrics,
  PlatformSubscription,
} from "@/types";

/**
 * Indicadores da plataforma, derivados por funcao pura.
 *
 * Fronteira que nao se cruza: estas funcoes recebem `platformSubscriptions` e
 * `platformInvoices` e NADA MAIS. Elas nao conhecem
 * `organizations/{orgId}/transactions`, e os agregados de `/financeiro`
 * (`src/services/aggregates.ts`) nao conhecem estas colecoes. Somar as duas
 * coisas transformaria consulta de paciente em receita da Three Devs.
 *
 * As definicoes em prosa estao em `METRIC_DEFINITIONS` (`src/config/billing.ts`)
 * e sao exibidas junto dos numeros.
 */

/** Valor mensal equivalente. Plano anual entra dividido por 12. */
export function monthlyEquivalentInCents(
  amountInCents: number,
  interval: BillingInterval,
): number {
  return interval === "YEAR"
    ? Math.round(amountInCents / 12)
    : Math.round(amountInCents);
}

const REVENUE_STATUSES = new Set(["ACTIVE"]);
const DELINQUENT_STATUSES = new Set(["PAST_DUE", "UNPAID"]);
const OUTSTANDING_STATUSES = new Set(["OPEN", "PAST_DUE"]);

export function computePlatformMetrics(
  subscriptions: PlatformSubscription[],
  invoices: PlatformInvoice[],
): PlatformMetrics {
  let monthlyRecurringRevenueInCents = 0;
  let activeSubscriptions = 0;
  let trialingSubscriptions = 0;
  let delinquentSubscriptions = 0;
  let canceledSubscriptions = 0;

  for (const subscription of subscriptions) {
    if (REVENUE_STATUSES.has(subscription.status)) {
      monthlyRecurringRevenueInCents += monthlyEquivalentInCents(
        subscription.amountInCents,
        subscription.interval,
      );
      activeSubscriptions += 1;
    } else if (subscription.status === "TRIALING") {
      trialingSubscriptions += 1;
    } else if (DELINQUENT_STATUSES.has(subscription.status)) {
      delinquentSubscriptions += 1;
    } else if (subscription.status === "CANCELED") {
      canceledSubscriptions += 1;
    }
  }

  let outstandingInCents = 0;
  let collectedInCents = 0;
  let refundedInCents = 0;

  for (const invoice of invoices) {
    if (OUTSTANDING_STATUSES.has(invoice.status)) {
      outstandingInCents += invoice.amountDueInCents - invoice.amountPaidInCents;
    }
    collectedInCents += invoice.amountPaidInCents;
    refundedInCents += invoice.amountRefundedInCents;
  }

  // O denominador do churn inclui as canceladas: sem elas, cancelar reduziria a
  // base e faria a taxa cair justamente quando piora.
  const knownSubscriptions =
    activeSubscriptions +
    trialingSubscriptions +
    delinquentSubscriptions +
    canceledSubscriptions;

  return {
    monthlyRecurringRevenueInCents,
    annualRunRateInCents: monthlyRecurringRevenueInCents * 12,
    activeSubscriptions,
    trialingSubscriptions,
    delinquentSubscriptions,
    outstandingInCents,
    netCollectedInCents: collectedInCents - refundedInCents,
    refundedInCents,
    canceledSubscriptions,
    churnRate:
      knownSubscriptions === 0
        ? 0
        : canceledSubscriptions / knownSubscriptions,
  };
}
