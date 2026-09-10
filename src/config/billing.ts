import type {
  BillingInterval,
  ID,
  PlatformInvoiceStatus,
  PlatformPlan,
  PlatformSubscriptionStatus,
} from "@/types";

/**
 * Politica de cobranca da plataforma, como DADO.
 *
 * Este arquivo e compartilhado com o backend: `scripts/build-functions.mjs` o
 * transpila para `functions/generated/billing-config.js`, do mesmo jeito que ja
 * faz com os caminhos e os enums de acesso. Por isso ele nao importa nada alem
 * de tipos — nem SDK, nem `process.env`, nem componente.
 *
 * O identificador do preco no gateway NAO mora aqui de proposito. Quem resolve
 * `planId -> price` e o backend (`functions/billing.js`, a partir do Secret
 * Manager): assim o navegador nunca escolhe quanto vai ser cobrado, so qual
 * plano quer assinar.
 */

/**
 * Catalogo PROVISORIO. Nomes, precos e modulos definitivos continuam com o
 * titular; estes valores existem para exercitar o
 * fluxo inteiro no ambiente de testes e devem ser revistos antes de qualquer
 * cobranca real. Precos em centavos inteiros.
 */
export const PLATFORM_PLANS: PlatformPlan[] = [
  {
    id: "essencial-mensal",
    name: "Essencial",
    description: "Agenda e cadastro para quem atende sozinho.",
    priceInCents: 9_900,
    currency: "BRL",
    interval: "MONTH",
    modules: ["dashboard", "agenda", "clientes", "configuracoes"],
    trialDays: 7,
    active: true,
  },
  {
    id: "profissional-mensal",
    name: "Profissional",
    description: "Acrescenta caixa de entrada, financeiro e a Dara.",
    priceInCents: 19_900,
    currency: "BRL",
    interval: "MONTH",
    modules: [
      "dashboard",
      "agenda",
      "clientes",
      "mensagens",
      "financeiro",
      "agente",
      "configuracoes",
    ],
    trialDays: 7,
    active: true,
  },
  {
    id: "profissional-anual",
    name: "Profissional anual",
    description: "O plano Profissional com doze meses pagos de uma vez.",
    priceInCents: 199_000,
    currency: "BRL",
    interval: "YEAR",
    modules: [
      "dashboard",
      "agenda",
      "clientes",
      "mensagens",
      "financeiro",
      "agente",
      "configuracoes",
    ],
    trialDays: 0,
    active: true,
  },
];

export function findPlan(planId: ID): PlatformPlan | null {
  return PLATFORM_PLANS.find((plan) => plan.id === planId) ?? null;
}

export function activePlans(): PlatformPlan[] {
  return PLATFORM_PLANS.filter((plan) => plan.active);
}

/**
 * Tolerancia depois do fim do ciclo antes de o painel fechar.
 *
 * Valor provisorio, ainda a confirmar pelo titular: cinco dias. A razao
 * de existir tolerancia e que a recusa de cartao quase sempre e transitoria
 * (limite, cartao vencido) e a Stripe retenta por alguns dias; fechar o painel
 * na primeira falha derrubaria o atendimento de quem so precisa trocar o
 * cartao. A razao de ser CURTA e que a tolerancia e credito nao cobrado.
 */
export const GRACE_PERIOD_DAYS = 5;

/**
 * Cancelamento e inadimplencia terminal NAO ganham tolerancia: o acesso vai ate
 * o fim do ciclo efetivamente pago e para ali.
 */
export const CANCELLATION_GRACE_DAYS = 0;

export const BILLING_INTERVAL_LABELS: Record<BillingInterval, string> = {
  MONTH: "mensal",
  YEAR: "anual",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<
  PlatformSubscriptionStatus,
  string
> = {
  TRIALING: "Periodo de teste",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelada",
  INCOMPLETE: "Aguardando confirmacao",
  UNPAID: "Nao paga",
};

export const INVOICE_STATUS_LABELS: Record<PlatformInvoiceStatus, string> = {
  OPEN: "Em aberto",
  PAID: "Paga",
  PAST_DUE: "Vencida",
  VOID: "Cancelada",
  UNCOLLECTIBLE: "Nao recebida",
  REFUNDED: "Reembolsada",
  PARTIALLY_REFUNDED: "Reembolsada em parte",
};

/**
 * Definicoes dos indicadores, exibidas junto dos numeros na visao
 * administrativa. Um indicador sem definicao escrita e um numero que cada
 * pessoa interpreta de um jeito — e receita recorrente e o caso classico disso.
 */
export const METRIC_DEFINITIONS = {
  monthlyRecurringRevenue:
    "Soma do valor mensal normalizado das assinaturas ativas. Plano anual entra dividido por 12. Periodo de teste e inadimplencia nao entram.",
  annualRunRate:
    "Receita recorrente mensal multiplicada por 12. E uma projecao do ritmo atual, nao o faturamento do ano.",
  outstanding:
    "Soma das faturas em aberto e vencidas. Nao inclui faturas canceladas nem dadas como incobraveis.",
  netCollected:
    "Total recebido nas faturas menos o total reembolsado, sobre todo o periodo carregado.",
  churnRate:
    "Assinaturas canceladas sobre o total de assinaturas conhecidas (ativas, em teste, inadimplentes e canceladas).",
} as const;
