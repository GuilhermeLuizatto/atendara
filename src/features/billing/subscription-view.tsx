"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { APP_NAME, OPERATOR_NAME } from "@/config/app";
import {
  BILLING_INTERVAL_LABELS,
  INVOICE_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  activePlans,
  findPlan,
} from "@/config/billing";
import { canManageSubscription } from "@/config/access";
import { ACCESS_GRANT_KIND_LABELS } from "@/config/platform";
import { isGrantInForce } from "@/lib/platform/access-gate";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { safeExternalUrl } from "@/lib/utils/url";
import { useNow } from "@/lib/utils/use-now";
import { useAuth } from "@/providers/auth-provider";
import { platformBillingClient } from "@/services/billing";
import { platformAccessReader } from "@/services/platform-access";

import { PlatformNotices } from "./platform-notices";
import type { BadgeTone } from "@/components/ui";
import type {
  PlatformAccessGrant,
  PlatformInvoice,
  PlatformSubscription,
  PlatformSubscriptionStatus,
} from "@/types";

const STATUS_TONE: Record<PlatformSubscriptionStatus, BadgeTone> = {
  TRIALING: "info",
  ACTIVE: "success",
  PAST_DUE: "warning",
  CANCELED: "neutral",
  INCOMPLETE: "warning",
  UNPAID: "danger",
};

/**
 * "Minha assinatura" — o assinante e a propria organizacao dele, nada alem.
 *
 * Separada de `/financeiro` de proposito e sem nenhum ponto de contato: la
 * estao as receitas e despesas do negocio do assinante; aqui esta o que ele
 * paga a {OPERATOR_NAME}. Nenhum valor desta tela entra naquele fluxo de caixa,
 * e nenhum numero de la aparece aqui.
 *
 * Tudo nesta tela e leitura, com uma excecao que tambem nao decide nada: os
 * botoes levam ao checkout e ao portal hospedados, e o pedido de cancelamento
 * vai para o gateway. A situacao so muda quando o evento assinado chega ao
 * backend — por isso o aviso de que voltar do pagamento nao confirma nada.
 */
export function SubscriptionView() {
  const { user } = useAuth();
  const billing = platformBillingClient();
  const access = platformAccessReader();
  const now = useNow();
  const organizationId = user?.access?.organizationId ?? null;
  const allowed = canManageSubscription(user?.access);

  const [subscription, setSubscription] = useState<PlatformSubscription | null>(null);
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
  const [grant, setGrant] = useState<PlatformAccessGrant | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /**
   * O `setState` acontece sempre dentro de um callback assincrono, nunca no
   * corpo do efeito: e o que a regra `react-hooks/set-state-in-effect` do React
   * Compiler exige, e e o mesmo padrao da tela de administracao.
   */
  const load = useCallback(() => {
    if (!organizationId || !billing.available) {
      return Promise.resolve().then(() => setLoading(false));
    }
    return Promise.all([
      billing.subscription(organizationId),
      billing.invoices(organizationId),
      access.accessGrant(organizationId),
    ])
      .then(([current, history, currentGrant]) => {
        setSubscription(current);
        setInvoices(history);
        setGrant(currentGrant);
      })
      .catch(() => setError("Não foi possível carregar sua assinatura agora."))
      .finally(() => setLoading(false));
  }, [access, billing, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function go(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    try {
      window.location.href = await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível continuar.");
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      await billing.requestCancellation();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível solicitar o cancelamento.");
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) return null;

  const plan = subscription?.planId ? findPlan(subscription.planId) : null;
  const vigente = subscription?.status === "ACTIVE" || subscription?.status === "TRIALING";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Minha assinatura"
        description={`O que você paga à ${OPERATOR_NAME} pelo uso do ${APP_NAME}. Esta área não se mistura com o financeiro do seu negócio.`}
        actions={
          subscription ? (
            <Badge tone={STATUS_TONE[subscription.status]} dot>
              {SUBSCRIPTION_STATUS_LABELS[subscription.status]}
            </Badge>
          ) : null
        }
      />

      {/* Avisos da operadora sobre a assinatura. Derivados do estado, nunca
          gravados: quem escreve situacao e validade e o webhook. */}
      {billing.available && !loading ? (
        <PlatformNotices subscription={subscription} />
      ) : null}

      {!billing.available ? (
        <Card>
          <CardBody>
            <p className="text-muted-foreground text-sm">
              A cobrança depende de um projeto real configurado. No modo
              demonstração não existe assinatura — e não inventamos uma.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      {/* Concessao da operadora, separada da assinatura: nao gera fatura e nao
          e cobranca. O acesso vale ate a maior data entre as duas. */}
      {grant && isGrantInForce(grant, now.getTime()) ? (
        <Card>
          <CardHeader>
            <CardTitle>Acesso concedido pela operadora</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="text-foreground text-sm">
              {`A ${OPERATOR_NAME} liberou seu acesso até ${formatDate(grant.until)} (${ACCESS_GRANT_KIND_LABELS[grant.kind].toLowerCase()}).`}
            </p>
            <p className="text-muted-foreground text-sm">
              Não é cobrança: nenhuma fatura corresponde a este período. Se você assinar, o acesso segue até a data
              mais distante entre a assinatura e esta concessão.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Plano atual</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {loading ? (
            <p className="text-muted-foreground text-sm">Carregando...</p>
          ) : subscription ? (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Plano" value={plan?.name ?? subscription.planId ?? "—"} />
              <Detail
                label="Valor"
                value={`${formatCurrency(subscription.amountInCents)} / ${BILLING_INTERVAL_LABELS[subscription.interval]}`}
              />
              <Detail
                label={subscription.cancelAtPeriodEnd ? "Encerra em" : "Próxima cobrança"}
                value={subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "—"}
              />
              <Detail
                label="Acesso liberado até"
                value={subscription.accessUntil ? formatDate(subscription.accessUntil) : "—"}
                hint="Inclui a tolerância após o fim do ciclo."
              />
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">
              Você ainda não tem uma assinatura. Escolha um plano abaixo.
            </p>
          )}

          {subscription?.cancelAtPeriodEnd ? (
            <p className="bg-warning-soft text-warning-soft-foreground rounded-lg p-3 text-sm">
              O cancelamento está agendado. O acesso continua até o fim do ciclo
              já pago e não haverá nova cobrança.
            </p>
          ) : null}

          <p className="bg-surface-muted text-muted-foreground rounded-lg p-3 text-sm">
            A liberação acontece quando o gateway confirma o pagamento, e não
            quando você volta da tela de pagamento. Se acabou de pagar, atualize
            esta página em instantes.
          </p>

          {subscription ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || !billing.available} onClick={() => void go(() => billing.openPortal())}>
                Gerenciar pagamento
              </Button>
              {vigente && !subscription.cancelAtPeriodEnd ? (
                <Button variant="outline" disabled={busy} onClick={() => void cancel()}>
                  Cancelar ao fim do ciclo
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {!vigente ? (
        <Card>
          <CardHeader>
            <CardTitle>Planos</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activePlans().map((option) => (
                <li key={option.id} className="border-border flex flex-col gap-2 rounded-lg border p-4">
                  <p className="text-foreground font-medium">{option.name}</p>
                  <p className="text-muted-foreground text-sm">{option.description}</p>
                  <p className="text-foreground text-lg font-semibold tabular-nums">
                    {formatCurrency(option.priceInCents)}
                    <span className="text-muted-foreground text-sm font-normal">
                      {" "}
                      / {BILLING_INTERVAL_LABELS[option.interval]}
                    </span>
                  </p>
                  {option.trialDays > 0 ? (
                    <p className="text-subtle-foreground text-xs">
                      {option.trialDays} dias de teste antes da primeira cobrança.
                    </p>
                  ) : null}
                  <Button
                    className="mt-auto"
                    disabled={busy || !billing.available}
                    onClick={() => void go(() => billing.startCheckout(option.id))}
                  >
                    Assinar
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Cobranças</CardTitle>
        </CardHeader>
        <CardBody>
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma cobrança emitida ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Emissão</th>
                    <th className="py-2 pr-4 font-medium">Período</th>
                    <th className="py-2 pr-4 font-medium">Valor</th>
                    <th className="py-2 pr-4 font-medium">Situação</th>
                    <th className="py-2 font-medium">Comprovante</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-border border-t">
                      <td className="py-2 pr-4 whitespace-nowrap">{formatDate(invoice.issuedAt)}</td>
                      <td className="text-muted-foreground py-2 pr-4 whitespace-nowrap">
                        {invoice.periodEnd ? `até ${formatDate(invoice.periodEnd)}` : "—"}
                      </td>
                      <td className="py-2 pr-4 tabular-nums whitespace-nowrap">
                        {formatCurrency(invoice.amountDueInCents)}
                        {invoice.amountRefundedInCents > 0 ? (
                          <span className="text-muted-foreground">
                            {" "}
                            (-{formatCurrency(invoice.amountRefundedInCents)})
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge tone={invoiceTone(invoice)}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
                      </td>
                      <td className="py-2">
                        {safeExternalUrl(invoice.hostedInvoiceUrl) ? (
                          <a
                            className="text-primary underline"
                            href={safeExternalUrl(invoice.hostedInvoiceUrl)!}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Abrir
                          </a>
                        ) : (
                          <span className="text-subtle-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function invoiceTone(invoice: PlatformInvoice): BadgeTone {
  switch (invoice.status) {
    case "PAID":
      return "success";
    case "PAST_DUE":
    case "UNCOLLECTIBLE":
      return "danger";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "info";
    case "OPEN":
      return "warning";
    default:
      return "neutral";
  }
}

function Detail({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-foreground mt-1 text-sm font-medium">{value}</dd>
      {hint ? <p className="text-subtle-foreground mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}
