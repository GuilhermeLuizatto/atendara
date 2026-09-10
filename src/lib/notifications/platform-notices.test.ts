import { describe, expect, it } from "vitest";

import type { PlatformSubscription } from "@/types";

import { platformNoticesFor } from "./platform-notices";

const NOW = "2026-09-10T12:00:00.000Z";

function subscription(
  overrides: Partial<PlatformSubscription> = {},
): PlatformSubscription {
  return {
    organizationId: "org-teste",
    subscriberUserId: "dono",
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

function events(...args: Parameters<typeof platformNoticesFor>): string[] {
  return platformNoticesFor(...args).map((notice) => notice.event);
}

describe("avisos da plataforma ao assinante", () => {
  it("assinatura em dia e longe do vencimento nao gera aviso", () => {
    expect(events(subscription(), NOW)).toEqual([]);
  });

  it("sem assinatura, avisa que nao ha assinatura", () => {
    expect(events(null, NOW)).toEqual(["NO_SUBSCRIPTION"]);
  });

  it("periodo de teste terminando entra na janela configurada", () => {
    const longe = subscription({
      status: "TRIALING",
      currentPeriodEnd: "2026-09-20T00:00:00.000Z",
      accessUntil: "2026-09-25T00:00:00.000Z",
    });
    const perto = subscription({
      status: "TRIALING",
      currentPeriodEnd: "2026-09-12T00:00:00.000Z",
      accessUntil: "2026-09-17T00:00:00.000Z",
    });

    expect(events(longe, NOW)).toEqual([]);
    expect(events(perto, NOW)).toEqual(["TRIAL_ENDING"]);
  });

  it("pagamento pendente avisa e o acesso vencendo se soma", () => {
    const item = subscription({
      status: "PAST_DUE",
      accessUntil: "2026-09-12T00:00:00.000Z",
    });

    expect(events(item, NOW)).toEqual(["PAYMENT_PENDING", "ACCESS_ENDING"]);
  });

  it("assinatura encerrada nao repete o aviso de acesso vencendo", () => {
    // Encerrada, o aviso de cancelamento ja diz o que precisa ser dito; somar o
    // de vencimento so faria a mesma pessoa ler duas versoes do mesmo fato.
    const item = subscription({
      status: "CANCELED",
      accessUntil: "2026-09-12T00:00:00.000Z",
      canceledAt: "2026-09-09T00:00:00.000Z",
    });

    expect(events(item, NOW)).toEqual(["SUBSCRIPTION_CANCELED"]);
  });

  it("a gravidade sobe no ultimo dia de acesso", () => {
    const notices = platformNoticesFor(
      subscription({ accessUntil: "2026-09-11T00:00:00.000Z" }),
      NOW,
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      event: "ACCESS_ENDING",
      severity: "CRITICAL",
    });
  });

  it("todo aviso da plataforma fica dentro do painel", () => {
    const todos = [
      ...platformNoticesFor(null, NOW),
      ...platformNoticesFor(subscription({ status: "PAST_DUE" }), NOW),
      ...platformNoticesFor(subscription({ status: "UNPAID" }), NOW),
      ...platformNoticesFor(
        subscription({ status: "TRIALING", currentPeriodEnd: NOW }),
        NOW,
      ),
    ];

    expect(todos.length).toBeGreaterThan(0);
    // Nenhum aviso da operadora sai por canal de clinica: sao remetentes,
    // audiencias e bases legais diferentes.
    for (const notice of todos) expect(notice.channel).toBe("IN_APP");
  });
});
