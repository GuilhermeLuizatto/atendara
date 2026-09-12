import type { CurrencyCode, ID, ISODateString } from "./common";
import type { AppModule } from "./access";

/**
 * Cobranca DA PLATAFORMA — a mensalidade que a Three Devs cobra de clinicas e
 * profissionais assinantes do Nexo.
 *
 * Nao confundir com `./finance.ts`, que modela o financeiro OPERACIONAL do
 * assinante (receita de atendimento, despesas, saldo de paciente). Sao duas
 * contabilidades com donos diferentes e elas nunca se encontram: uma
 * mensalidade da Three Devs jamais vira `Transaction` de um tenant, e nenhum
 * indicador soma os dois.
 *
 * Valores em centavos inteiros, como no resto do produto (regra 7 do AGENTS).
 */

/** Ciclo de cobranca do plano. */
export type BillingInterval = "MONTH" | "YEAR";

export interface PlatformPlan {
  id: ID;
  name: string;
  description: string;
  priceInCents: number;
  currency: CurrencyCode;
  interval: BillingInterval;
  /** Modulos que o plano libera em `accounts/{uid}.modules`. */
  modules: AppModule[];
  trialDays: number;
  active: boolean;
}

/**
 * Situacao da assinatura, no vocabulario do produto.
 *
 * Traduz os estados do gateway; o mapeamento vive em `src/lib/billing/policy.ts`
 * e e a unica coisa que decide `subscriptionStatus` e `accessUntil` da conta.
 */
export type PlatformSubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "INCOMPLETE"
  | "UNPAID";

/** Referencia ao objeto correspondente no gateway. Espelho, nunca autoridade. */
export interface PlatformGatewayRef {
  provider: "STRIPE";
  customerId: string;
  subscriptionId: string | null;
}

/**
 * Uma assinatura por organizacao. O id do documento E o `organizationId`:
 * isso torna impossivel uma organizacao acumular duas assinaturas ativas.
 */
export interface PlatformSubscription {
  organizationId: ID;
  /** Quem assinou. Confirmado contra `accounts/{uid}.organizationId`. */
  subscriberUserId: ID;
  subscriberEmail: string;
  planId: ID;
  status: PlatformSubscriptionStatus;
  amountInCents: number;
  currency: CurrencyCode;
  interval: BillingInterval;
  currentPeriodStart: ISODateString | null;
  currentPeriodEnd: ISODateString | null;
  /** Ate quando o painel fica aberto. Espelha `accounts/{uid}.accessUntil`. */
  accessUntil: ISODateString | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: ISODateString | null;
  gateway: PlatformGatewayRef;
  /**
   * Instante do ultimo evento do gateway APLICADO a este documento. E o que
   * descarta evento fora de ordem: um evento mais antigo que este nao reescreve
   * o estado.
   */
  lastEventAt: ISODateString | null;
  lastEventId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type PlatformInvoiceStatus =
  | "OPEN"
  | "PAID"
  | "PAST_DUE"
  | "VOID"
  | "UNCOLLECTIBLE"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

/**
 * Cada cobranca emitida. Append-only na pratica: as Security Rules recusam
 * escrita do cliente, e so o backend acrescenta ou atualiza o proprio espelho.
 */
export interface PlatformInvoice {
  id: ID;
  organizationId: ID;
  subscriptionId: string | null;
  planId: ID;
  status: PlatformInvoiceStatus;
  amountDueInCents: number;
  amountPaidInCents: number;
  amountRefundedInCents: number;
  currency: CurrencyCode;
  periodStart: ISODateString | null;
  periodEnd: ISODateString | null;
  issuedAt: ISODateString;
  paidAt: ISODateString | null;
  /** Fatura hospedada pelo gateway. O assinante ve o comprovante ali. */
  hostedInvoiceUrl: string | null;
  gatewayInvoiceId: string;
  lastEventAt: ISODateString | null;
  lastEventId: string | null;
}

/** Como um evento recebido do gateway foi tratado. */
export type GatewayEventOutcome =
  | "APPLIED"
  | "IGNORED"
  | "OUT_OF_ORDER"
  | "REJECTED";

/**
 * Trilha dos eventos do gateway, chaveada pelo id do evento. E o que garante
 * idempotencia: o documento e criado na MESMA transacao que aplica o efeito,
 * entao a repeticao do webhook aborta antes de estender acesso duas vezes.
 */
export interface PlatformGatewayEvent {
  id: string;
  type: string;
  organizationId: ID | null;
  outcome: GatewayEventOutcome;
  /** Motivo legivel quando o evento nao foi aplicado. */
  reason: string | null;
  /** Instante em que o gateway gerou o evento — a base da ordenacao. */
  gatewayCreatedAt: ISODateString;
  receivedAt: ISODateString;
}

/**
 * Indicadores da plataforma. As definicoes sao explicitas de proposito: "receita
 * recorrente" tem meia duzia de leituras possiveis, e um numero sem definicao
 * nao serve para decidir nada.
 */
export interface PlatformMetrics {
  /**
   * MRR — soma do valor mensal normalizado das assinaturas em `ACTIVE`.
   * Plano anual entra dividido por 12. `TRIALING` NAO entra (ainda nao pagou),
   * `PAST_DUE` NAO entra (a cobranca do ciclo falhou).
   */
  monthlyRecurringRevenueInCents: number;
  /** ARR — o MRR multiplicado por 12. Nao e a soma do faturado no ano. */
  annualRunRateInCents: number;
  /** Assinaturas em `ACTIVE` ou `TRIALING`. */
  activeSubscriptions: number;
  trialingSubscriptions: number;
  /** Assinaturas em `PAST_DUE` ou `UNPAID`. */
  delinquentSubscriptions: number;
  /** Soma em aberto das faturas `OPEN` e `PAST_DUE`. */
  outstandingInCents: number;
  /** Recebido menos reembolsado, sobre as faturas emitidas. */
  netCollectedInCents: number;
  refundedInCents: number;
  canceledSubscriptions: number;
  /** Canceladas / (ativas + trial + inadimplentes + canceladas). */
  churnRate: number;
}
