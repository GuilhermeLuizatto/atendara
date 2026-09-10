"use client";

import { useEffect, useState } from "react";

import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import {
  BILLING_INTERVAL_LABELS,
  INVOICE_STATUS_LABELS,
  METRIC_DEFINITIONS,
  SUBSCRIPTION_STATUS_LABELS,
  findPlan,
} from "@/config/billing";
import { computePlatformMetrics } from "@/lib/billing/metrics";
import { formatCurrency, formatDate, formatDateTime, formatPercent } from "@/lib/utils/format";
import { platformBillingClient } from "@/services/billing";
import type {
  PlatformGatewayEvent,
  PlatformInvoice,
  PlatformSubscription,
} from "@/types";

const EVENT_TONE: Record<PlatformGatewayEvent["outcome"], BadgeTone> = {
  APPLIED: "success",
  IGNORED: "neutral",
  OUT_OF_ORDER: "warning",
  REJECTED: "danger",
};

/**
 * Financeiro da plataforma — o que a operadora recebe dos assinantes.
 *
 * Le exclusivamente `platformSubscriptions`, `platformInvoices` e
 * `platformGatewayEvents`. Nao existe consulta a `organizations/{orgId}` nesta
 * tela: se existisse, consulta de paciente viraria receita da operadora no
 * mesmo grafico.
 *
 * Quem entra aqui e `PLATFORM_ADMIN`, conferido no documento da conta pelas
 * Security Rules. Nenhuma comparacao de e-mail decide nada — o e-mail e so o
 * endereco de quem ocupa o papel hoje.
 */
export function PlatformBillingPanel() {
  const billing = platformBillingClient();
  const [subscriptions, setSubscriptions] = useState<PlatformSubscription[]>([]);
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
  const [events, setEvents] = useState<PlatformGatewayEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      billing.allSubscriptions(),
      billing.allInvoices(),
      billing.recentGatewayEvents(),
    ])
      .then(([nextSubscriptions, nextInvoices, nextEvents]) => {
        if (!active) return;
        setSubscriptions(nextSubscriptions);
        setInvoices(nextInvoices);
        setEvents(nextEvents);
      })
      .catch(() => {
        if (active) setError("Nao foi possivel carregar a cobranca da plataforma.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [billing]);

  const metrics = computePlatformMetrics(subscriptions, invoices);

  return (
    <div className="space-y-6">
      {!billing.available ? (
        <p className="bg-surface-muted text-muted-foreground rounded-lg p-3 text-sm">
          Sem projeto configurado nao ha cobranca para exibir.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      <section aria-label="Indicadores da plataforma" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Receita recorrente mensal"
          value={formatCurrency(metrics.monthlyRecurringRevenueInCents)}
          definition={METRIC_DEFINITIONS.monthlyRecurringRevenue}
        />
        <Metric
          label="Ritmo anual"
          value={formatCurrency(metrics.annualRunRateInCents)}
          definition={METRIC_DEFINITIONS.annualRunRate}
        />
        <Metric
          label="Em aberto"
          value={formatCurrency(metrics.outstandingInCents)}
          definition={METRIC_DEFINITIONS.outstanding}
        />
        <Metric
          label="Recebido liquido"
          value={formatCurrency(metrics.netCollectedInCents)}
          definition={METRIC_DEFINITIONS.netCollected}
        />
      </section>

      <section aria-label="Assinaturas por situacao" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Assinaturas ativas" value={String(metrics.activeSubscriptions)} />
        <Metric label="Em periodo de teste" value={String(metrics.trialingSubscriptions)} />
        <Metric label="Inadimplentes" value={String(metrics.delinquentSubscriptions)} />
        <Metric
          label="Cancelamento"
          value={formatPercent(metrics.churnRate)}
          definition={METRIC_DEFINITIONS.churnRate}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Assinaturas</CardTitle>
        </CardHeader>
        <CardBody>
          {loading ? (
            <p className="text-muted-foreground text-sm">Carregando...</p>
          ) : subscriptions.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma assinatura registrada.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Assinante</th>
                    <th className="py-2 pr-4 font-medium">Plano</th>
                    <th className="py-2 pr-4 font-medium">Valor</th>
                    <th className="py-2 pr-4 font-medium">Situacao</th>
                    <th className="py-2 pr-4 font-medium">Ciclo ate</th>
                    <th className="py-2 font-medium">Acesso ate</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((subscription) => (
                    <tr key={subscription.organizationId} className="border-border border-t">
                      <td className="py-2 pr-4">
                        <span className="text-foreground block">
                          {subscription.subscriberEmail ?? subscription.subscriberUserId}
                        </span>
                        <span className="text-subtle-foreground block font-mono text-xs">
                          {subscription.organizationId}
                        </span>
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {findPlan(subscription.planId)?.name ?? subscription.planId ?? "—"}
                      </td>
                      <td className="py-2 pr-4 tabular-nums whitespace-nowrap">
                        {formatCurrency(subscription.amountInCents)} /{" "}
                        {BILLING_INTERVAL_LABELS[subscription.interval]}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge tone={subscription.status === "ACTIVE" ? "success" : subscription.status === "CANCELED" ? "neutral" : "warning"}>
                          {SUBSCRIPTION_STATUS_LABELS[subscription.status]}
                        </Badge>
                      </td>
                      <td className="text-muted-foreground py-2 pr-4 whitespace-nowrap">
                        {subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "—"}
                      </td>
                      <td className="text-muted-foreground py-2 whitespace-nowrap">
                        {subscription.accessUntil ? formatDate(subscription.accessUntil) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cobrancas emitidas</CardTitle>
        </CardHeader>
        <CardBody>
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma cobranca emitida.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Emissao</th>
                    <th className="py-2 pr-4 font-medium">Organizacao</th>
                    <th className="py-2 pr-4 font-medium">Devido</th>
                    <th className="py-2 pr-4 font-medium">Pago</th>
                    <th className="py-2 pr-4 font-medium">Reembolsado</th>
                    <th className="py-2 font-medium">Situacao</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-border border-t">
                      <td className="py-2 pr-4 whitespace-nowrap">{formatDate(invoice.issuedAt)}</td>
                      <td className="text-subtle-foreground py-2 pr-4 font-mono text-xs">
                        {invoice.organizationId}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{formatCurrency(invoice.amountDueInCents)}</td>
                      <td className="py-2 pr-4 tabular-nums">{formatCurrency(invoice.amountPaidInCents)}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {formatCurrency(invoice.amountRefundedInCents)}
                      </td>
                      <td className="py-2">
                        <Badge tone={invoice.status === "PAID" ? "success" : invoice.status === "OPEN" ? "warning" : "neutral"}>
                          {INVOICE_STATUS_LABELS[invoice.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eventos recebidos do gateway</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Trilha append-only, chaveada pelo id do evento. E ela que faz um
            webhook repetido nao cobrar nem liberar duas vezes.
          </p>
          {events.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum evento recebido.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((event) => (
                <li key={event.id} className="border-border flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
                  <Badge tone={EVENT_TONE[event.outcome]}>{event.outcome}</Badge>
                  <span className="text-foreground font-mono text-xs">{event.type}</span>
                  <span className="text-muted-foreground text-xs">{formatDateTime(event.receivedAt)}</span>
                  {event.reason ? (
                    <span className="text-subtle-foreground text-xs">{event.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Metric({ label, value, definition }: { label: string; value: string; definition?: string }) {
  return (
    <Card className="p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="text-foreground mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {definition ? <p className="text-subtle-foreground mt-1.5 text-xs">{definition}</p> : null}
    </Card>
  );
}
