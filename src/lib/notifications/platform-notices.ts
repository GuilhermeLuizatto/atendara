import { PLATFORM_NOTICE_WINDOW_DAYS } from "@/config/notifications";
import type {
  ISODateString,
  PlatformNotice,
  PlatformSubscription,
} from "@/types";

/**
 * Avisos da operadora ao assinante.
 *
 * Sao a outra metade do assunto "notificacao", e nao compartilham nada com os
 * avisos que a clinica manda para quem ela atende: outro remetente, outra
 * audiencia, outra base legal. Um aviso de mensalidade nunca sai por canal de
 * clinica, e nenhum destes vira `NotificationDelivery`.
 *
 * Sao DERIVADOS da assinatura, nao gravados. A situacao ja e escrita
 * exclusivamente pelo webhook (AGENTS.md, regra 10); persistir um aviso criaria
 * uma segunda copia da mesma verdade, livre para divergir da primeira. Funcao
 * pura, sem relogio proprio: quem chama informa o instante.
 *
 * Hoje o canal e sempre `IN_APP`. Enviar isto por e-mail depende de ativacao
 * futura — inclusive de um remetente verificado da operadora, que nao existe.
 */

const DAY_MS = 86_400_000;

function daysUntil(target: ISODateString | null, now: ISODateString): number | null {
  if (!target) return null;
  return (Date.parse(target) - Date.parse(now)) / DAY_MS;
}

export function platformNoticesFor(
  subscription: PlatformSubscription | null,
  now: ISODateString,
): PlatformNotice[] {
  if (!subscription) {
    return [
      {
        event: "NO_SUBSCRIPTION",
        severity: "ATTENTION",
        channel: "IN_APP",
        title: "Nenhuma assinatura ativa",
        body: "Escolha um plano para manter o painel aberto depois do período de avaliação.",
        actionLabel: "Ver planos",
        actionHref: "/assinatura",
      },
    ];
  }

  const notices: PlatformNotice[] = [];
  const untilAccessEnds = daysUntil(subscription.accessUntil, now);
  const untilPeriodEnds = daysUntil(subscription.currentPeriodEnd, now);

  if (
    subscription.status === "TRIALING" &&
    untilPeriodEnds !== null &&
    untilPeriodEnds <= PLATFORM_NOTICE_WINDOW_DAYS.trialEnding
  ) {
    notices.push({
      event: "TRIAL_ENDING",
      severity: "INFO",
      channel: "IN_APP",
      title: "Período de teste terminando",
      body: "A primeira cobrança acontece no fim do período de teste. Confira o plano e a forma de pagamento.",
      actionLabel: "Ver assinatura",
      actionHref: "/assinatura",
    });
  }

  if (subscription.status === "PAST_DUE" || subscription.status === "INCOMPLETE") {
    notices.push({
      event: "PAYMENT_PENDING",
      severity: "ATTENTION",
      channel: "IN_APP",
      title: "Pagamento pendente",
      body: "A última cobrança não foi confirmada. Atualize a forma de pagamento para não perder o acesso.",
      actionLabel: "Regularizar",
      actionHref: "/assinatura",
    });
  }

  if (subscription.status === "CANCELED" || subscription.status === "UNPAID") {
    notices.push({
      event: "SUBSCRIPTION_CANCELED",
      severity: "CRITICAL",
      channel: "IN_APP",
      title: "Assinatura encerrada",
      body: untilAccessEnds !== null && untilAccessEnds > 0
        ? "O acesso vai até o fim do ciclo já pago. Depois disso, só uma nova assinatura reabre o painel."
        : "O acesso ao painel está encerrado. Uma nova assinatura reabre o painel.",
      actionLabel: "Assinar novamente",
      actionHref: "/assinatura",
    });
  }

  // O aviso de acesso vencendo so faz sentido enquanto a assinatura ainda pode
  // se recuperar: encerrada, o aviso acima ja diz o que precisa ser dito.
  const recoverable =
    subscription.status === "ACTIVE" ||
    subscription.status === "TRIALING" ||
    subscription.status === "PAST_DUE";

  if (
    recoverable &&
    untilAccessEnds !== null &&
    untilAccessEnds >= 0 &&
    untilAccessEnds <= PLATFORM_NOTICE_WINDOW_DAYS.accessEnding
  ) {
    notices.push({
      event: "ACCESS_ENDING",
      severity: untilAccessEnds <= 1 ? "CRITICAL" : "ATTENTION",
      channel: "IN_APP",
      title: "Acesso vencendo",
      body: "A validade do acesso está perto do fim. A renovação é confirmada pelo pagamento.",
      actionLabel: "Ver assinatura",
      actionHref: "/assinatura",
    });
  }

  return notices;
}
