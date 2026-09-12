"use client";

import { useCallback } from "react";

import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { LoadMore } from "@/components/ui/load-more";
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
import type { PageRequest, PlatformGatewayEvent } from "@/types";

import { usePagedList } from "./use-paged-list";

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
  const fetchSubscriptions = useCallback((request: PageRequest) => billing.allSubscriptions(request), [billing]);
  const fetchInvoices = useCallback((request: PageRequest) => billing.allInvoices(request), [billing]);
  const fetchEvents = useCallback((request: PageRequest) => billing.recentGatewayEvents(request), [billing]);
  const subscriptions = usePagedList(fetchSubscriptions, "Não foi possível carregar as assinaturas.");
  const invoices = usePagedList(fetchInvoices, "Não foi possível carregar as cobranças.");
  const events = usePagedList(fetchEvents, "Não foi possível carregar os eventos do gateway.");

  const metrics = computePlatformMetrics(subscriptions.items, invoices.items);
  const partial = subscriptions.page.hasMore || invoices.page.hasMore;
  const error = subscriptions.error || invoices.error || events.error;

  return (
    <div className="space-y-6">
      {!billing.available ? (
        <p className="bg-surface-muted text-muted-foreground rounded-lg p-3 text-sm">
          Sem projeto configurado não há cobrança para exibir.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      {partial ? (
        <p className="bg-warning-soft text-warning-soft-foreground rounded-lg p-3 text-sm">
          Os indicadores abaixo consideram só as assinaturas e cobranças já
          carregadas nas listas. Carregue o restante para incluir as demais.
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
          label="Recebido líquido"
          value={formatCurrency(metrics.netCollectedInCents)}
          definition={METRIC_DEFINITIONS.netCollected}
        />
      </section>

      <section aria-label="Assinaturas por situação" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Assinaturas ativas" value={String(metrics.activeSubscriptions)} />
        <Metric label="Em período de teste" value={String(metrics.trialingSubscriptions)} />
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
          {subscriptions.status === "loading" ? (
            <p role="status" className="text-muted-foreground text-sm">Carregando assinaturas...</p>
          ) : subscriptions.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma assinatura registrada.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Assinaturas da plataforma</caption>
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">Assinante</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Plano</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Valor</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Situação</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Ciclo até</th>
                    <th scope="col" className="py-2 font-medium">Acesso até</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.items.map((subscription) => (
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
        <LoadMore
          className="border-border border-t"
          page={subscriptions.page}
          summary={`Mostrando ${subscriptions.items.length} assinaturas.`}
          label="Carregar mais assinaturas"
          onLoadMore={() => void subscriptions.loadMore()}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cobranças emitidas</CardTitle>
        </CardHeader>
        <CardBody>
          {invoices.status === "loading" ? (
            <p role="status" className="text-muted-foreground text-sm">Carregando cobranças...</p>
          ) : invoices.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma cobrança emitida.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Cobranças emitidas pela plataforma</caption>
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">Emissão</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Organização</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Devido</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Pago</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Reembolsado</th>
                    <th scope="col" className="py-2 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.items.map((invoice) => (
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
        <LoadMore
          className="border-border border-t"
          page={invoices.page}
          summary={`Mostrando as ${invoices.items.length} cobranças mais recentes.`}
          label="Carregar cobranças anteriores"
          onLoadMore={() => void invoices.loadMore()}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eventos recebidos do gateway</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Trilha append-only, chaveada pelo id do evento. É ela que faz um
            webhook repetido não cobrar nem liberar duas vezes.
          </p>
          {events.status === "loading" ? (
            <p role="status" className="text-muted-foreground text-sm">Carregando eventos...</p>
          ) : events.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum evento recebido.</p>
          ) : (
            <ul className="space-y-2">
              {events.items.map((event) => (
                <li key={event.id} className="border-border flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
                  <Badge tone={EVENT_TONE[event.outcome]}>{event.outcome}</Badge>
                  <span className="text-foreground font-mono text-xs break-all">{event.type}</span>
                  <span className="text-muted-foreground text-xs">{formatDateTime(event.receivedAt)}</span>
                  {event.reason ? (
                    <span className="text-subtle-foreground text-xs">{event.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
        <LoadMore
          className="border-border border-t"
          page={events.page}
          summary={`Mostrando os ${events.items.length} eventos mais recentes.`}
          label="Carregar eventos anteriores"
          onLoadMore={() => void events.loadMore()}
        />
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
