import { CANCELLATION_GRACE_DAYS, GRACE_PERIOD_DAYS } from "@/config/billing";
import type { ISODateString, PlatformSubscriptionStatus } from "@/types";

/**
 * A politica que decide acesso a partir da cobranca.
 *
 * Funcoes puras, sem SDK e sem relogio proprio: e o mesmo arquivo que roda no
 * navegador (para EXIBIR a situacao) e no backend (para DECIDIR a situacao).
 * `scripts/build-functions.mjs` o transpila para
 * `functions/generated/billing-policy.js`.
 *
 * O navegador nunca aplica nada disto: quem escreve `subscriptionStatus` e
 * `accessUntil` em `accounts/{uid}` e exclusivamente o webhook, depois de
 * conferir a assinatura do gateway. Aqui mora so a regra; a autoridade mora no
 * servidor.
 */

/** Estados de assinatura da Stripe, como vem no evento. */
export const GATEWAY_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
] as const;

export type GatewaySubscriptionStatus =
  (typeof GATEWAY_SUBSCRIPTION_STATUSES)[number];

const STATUS_MAP: Record<GatewaySubscriptionStatus, PlatformSubscriptionStatus> =
  {
    trialing: "TRIALING",
    active: "ACTIVE",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    incomplete: "INCOMPLETE",
    // Uma assinatura que nunca teve o primeiro pagamento confirmado nao vira
    // "cancelada com direito ao ciclo": ela nunca deu direito a ciclo nenhum.
    incomplete_expired: "UNPAID",
    unpaid: "UNPAID",
    // "paused" e uma pausa de cobranca combinada com o assinante. Tratamos
    // como inadimplencia benigna: nada e cobrado e nada e liberado adiante.
    paused: "PAST_DUE",
  };

export function toPlatformStatus(raw: string): PlatformSubscriptionStatus {
  return STATUS_MAP[raw as GatewaySubscriptionStatus] ?? "INCOMPLETE";
}

/**
 * Traducao para o campo que ja existe em `accounts/{uid}` e que as Security
 * Rules leem. `PENDING` e "ainda pode voltar sozinho"; `CANCELLED` e "so volta
 * com uma nova assinatura".
 */
export function toAccountSubscriptionStatus(
  status: PlatformSubscriptionStatus,
): "ACTIVE" | "PENDING" | "CANCELLED" {
  switch (status) {
    case "ACTIVE":
    case "TRIALING":
      return "ACTIVE";
    case "PAST_DUE":
    case "INCOMPLETE":
      return "PENDING";
    case "CANCELED":
    case "UNPAID":
      return "CANCELLED";
  }
}

function addDays(iso: ISODateString, days: number): ISODateString {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

/**
 * Ate quando a conta PODE ter acesso — o teto, nao a garantia.
 *
 * A tolerancia (`GRACE_PERIOD_DAYS`) entra enquanto a assinatura ainda pode se
 * recuperar sozinha, inclusive em `PAST_DUE`. Quem abre o painel, porem, e a
 * situacao da conta: `PAST_DUE` vira `PENDING` e as regras exigem `ACTIVE`, entao
 * com cartao recusado o painel fecha na hora, por decisao do titular.
 * Cancelamento e inadimplencia terminal nao ganham tolerancia: o teto e o fim
 * do ciclo pago.
 *
 * `INCOMPLETE` devolve `null` porque nenhum pagamento foi confirmado: retornar
 * do checkout nao e prova de pagamento, e esta funcao e o lugar onde isso deixa
 * de ser uma frase e vira comportamento.
 */
export function computeAccessUntil(input: {
  status: PlatformSubscriptionStatus;
  currentPeriodEnd: ISODateString | null;
}): ISODateString | null {
  const { status, currentPeriodEnd } = input;
  if (status === "INCOMPLETE") return null;
  if (!currentPeriodEnd) return null;

  switch (status) {
    case "ACTIVE":
    case "TRIALING":
    case "PAST_DUE":
      return addDays(currentPeriodEnd, GRACE_PERIOD_DAYS);
    case "CANCELED":
    case "UNPAID":
      return addDays(currentPeriodEnd, CANCELLATION_GRACE_DAYS);
  }
}

/**
 * Reembolso integral do ciclo corrente encerra o acesso no instante do
 * reembolso: o dinheiro voltou, o periodo deixa de estar pago. A conta vai para
 * `PENDING` e nao para `CANCELLED` porque a assinatura pode seguir viva no
 * gateway — se ela for encerrada, o evento de cancelamento chega depois e
 * decide isso por conta propria.
 *
 * Reembolso parcial nao mexe no acesso: fica registrado na fatura.
 */
export function isFullRefund(
  amountPaidInCents: number,
  amountRefundedInCents: number,
): boolean {
  return amountPaidInCents > 0 && amountRefundedInCents >= amountPaidInCents;
}

/**
 * Evento fora de ordem.
 *
 * O gateway nao promete ordem de entrega, e retenta. Sem esta comparacao, um
 * `subscription.updated` antigo reentregue depois de um cancelamento
 * reabriria o acesso. A base e o instante em que o GATEWAY gerou o evento, nao
 * o instante em que ele chegou aqui.
 *
 * Empate no mesmo instante e aplicado: dois eventos com o mesmo carimbo nao
 * tem ordem conhecida, e recusar os dois travaria o estado.
 */
export function isOutOfOrder(
  lastAppliedAt: ISODateString | null,
  gatewayCreatedAt: ISODateString,
): boolean {
  if (!lastAppliedAt) return false;
  return Date.parse(gatewayCreatedAt) < Date.parse(lastAppliedAt);
}

/** Segundos do gateway (unix) para o ISO que o dominio usa. */
export function fromUnixSeconds(
  seconds: number | null | undefined,
): ISODateString | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}
