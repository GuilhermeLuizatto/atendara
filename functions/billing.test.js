import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeForm, signWebhookPayload, verifyWebhookSignature } from "./gateway.js";

/**
 * Cobranca da plataforma, sem emulador e sem rede.
 *
 * Aqui ficam as regras que precisam ser exercitadas caso a caso: assinatura do
 * webhook, idempotencia, ordem dos eventos e a fronteira que nunca pode ser
 * cruzada — nenhuma escrita em `organizations/{orgId}/transactions`. A prova de
 * ponta a ponta, com as Security Rules reais e a rede no meio, esta em
 * `src/lib/billing/platform-billing.access-test.ts`.
 */

const store = vi.hoisted(() => new Map());

vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({}) }));
vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_options, handler) => handler,
  onRequest: (_options, handler) => handler,
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("firebase-admin/firestore", () => {
  const snapshot = (path) => ({
    exists: store.has(path),
    data: () => store.get(path),
  });
  const transaction = {
    get: async (ref) => snapshot(ref.path),
    set: (ref, data, options) => {
      store.set(ref.path, options?.merge ? { ...(store.get(ref.path) ?? {}), ...data } : data);
    },
    update: (ref, data) => store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...data }),
    create: (ref, data) => {
      if (store.has(ref.path)) throw new Error(`ja existe: ${ref.path}`);
      store.set(ref.path, data);
    },
  };
  return {
    getFirestore: () => ({
      doc: (path) => ({ path, get: async () => snapshot(path) }),
      runTransaction: async (callback) => callback(transaction),
    }),
  };
});

const { applyGatewayEvent, cancelPlatformSubscription, createSubscriptionCheckout, openBillingPortal } =
  await import("./billing.js");
const { paths } = await import("./generated/paths.js");

const ORG = "org-assinante";
const USER = "usuario-assinante";
const CUSTOMER = "cus_teste";
const SUBSCRIPTION = "sub_teste";
const PLAN = "profissional-mensal";
const MODULES_DO_PLANO = [
  "dashboard",
  "agenda",
  "clientes",
  "mensagens",
  "financeiro",
  "agente",
  "configuracoes",
];

const seconds = (iso) => Math.floor(Date.parse(iso) / 1000);
const PERIODO_1_FIM = "2026-10-09T12:00:00.000Z";
const PERIODO_2_FIM = "2026-11-09T12:00:00.000Z";

function seedAccount(overrides = {}) {
  store.set(paths.account(USER), {
    userId: USER,
    email: "assinante@atendara.test",
    platformRole: "PROFESSIONAL",
    organizationId: ORG,
    status: "ACTIVE",
    subscriptionStatus: "PENDING",
    accessUntil: null,
    accessUntilMs: 0,
    modules: ["dashboard"],
    mustChangePassword: false,
    ...overrides,
  });
  store.set(paths.organization(ORG), { id: ORG, ownerId: USER, primaryProfession: "PSYCHOLOGIST" });
}

const checkoutEvent = (id, overrides = {}) => ({
  id,
  type: "checkout.session.completed",
  created: seconds("2026-09-09T12:00:00.000Z"),
  data: {
    object: {
      mode: "subscription",
      customer: CUSTOMER,
      subscription: SUBSCRIPTION,
      client_reference_id: ORG,
      metadata: { organizationId: ORG, subscriberUserId: USER, planId: PLAN },
      ...overrides,
    },
  },
});

const subscriptionEvent = (id, type, status, periodEnd, createdIso, overrides = {}) => ({
  id,
  type,
  created: seconds(createdIso),
  data: {
    object: {
      id: SUBSCRIPTION,
      customer: CUSTOMER,
      status,
      cancel_at_period_end: false,
      currency: "brl",
      current_period_start: seconds("2026-09-09T12:00:00.000Z"),
      current_period_end: seconds(periodEnd),
      items: { data: [{ price: { unit_amount: 19_900, recurring: { interval: "month" } } }] },
      metadata: { organizationId: ORG, subscriberUserId: USER, planId: PLAN },
      ...overrides,
    },
  },
});

const invoiceEvent = (id, type, invoiceId, periodEnd, createdIso, overrides = {}) => ({
  id,
  type,
  created: seconds(createdIso),
  data: {
    object: {
      id: invoiceId,
      customer: CUSTOMER,
      subscription: SUBSCRIPTION,
      currency: "brl",
      amount_due: 19_900,
      amount_paid: type === "invoice.paid" ? 19_900 : 0,
      created: seconds(createdIso),
      lines: { data: [{ period: { start: seconds("2026-09-09T12:00:00.000Z"), end: seconds(periodEnd) } }] },
      subscription_details: { metadata: { organizationId: ORG } },
      ...overrides,
    },
  },
});

const account = () => store.get(paths.account(USER));
const subscription = () => store.get(paths.platformSubscription(ORG));
const invoice = (id) => store.get(paths.platformInvoice(id));

beforeEach(() => {
  store.clear();
  seedAccount();
});

describe("Vinculo entre assinante, organizacao e assinatura", () => {
  it("associa e NAO libera acesso: sessao concluida nao e pagamento confirmado", async () => {
    const result = await applyGatewayEvent(checkoutEvent("evt_link"));

    expect(result.outcome).toBe("APPLIED");
    expect(store.get(paths.platformCustomer(CUSTOMER))).toMatchObject({ organizationId: ORG });
    expect(subscription()).toMatchObject({ status: "INCOMPLETE", accessUntil: null });
    // O portao de acesso continua exatamente como estava.
    expect(account()).toMatchObject({ subscriptionStatus: "PENDING", accessUntilMs: 0 });
  });

  it("recusa assinante que nao pertence a organizacao declarada", async () => {
    store.set(paths.account(USER), { ...account(), organizationId: "outra-organizacao" });

    const result = await applyGatewayEvent(checkoutEvent("evt_forjado"));

    expect(result.outcome).toBe("REJECTED");
    expect(subscription()).toBeUndefined();
  });

  it("recusa quem nao responde pela organizacao", async () => {
    store.set(paths.organization(ORG), { id: ORG, ownerId: "outro-dono" });

    const result = await applyGatewayEvent(checkoutEvent("evt_nao_dono"));

    expect(result.outcome).toBe("REJECTED");
    expect(store.get(paths.platformCustomer(CUSTOMER))).toBeUndefined();
  });

  it("recusa apontar um cliente do gateway para outra organizacao", async () => {
    store.set(paths.platformCustomer(CUSTOMER), { organizationId: "org-vizinha" });

    const result = await applyGatewayEvent(checkoutEvent("evt_desvio"));

    expect(result.outcome).toBe("REJECTED");
    expect(store.get(paths.platformCustomer(CUSTOMER))).toMatchObject({ organizationId: "org-vizinha" });
  });
});

describe("Ciclo de vida da assinatura", () => {
  it("criacao ativa o acesso ate o fim do ciclo mais a tolerancia", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );

    const esperado = new Date(Date.parse(PERIODO_1_FIM) + 5 * 86_400_000).toISOString();
    expect(subscription()).toMatchObject({ status: "ACTIVE", accessUntil: esperado });
    expect(account()).toMatchObject({
      subscriptionStatus: "ACTIVE",
      accessUntil: esperado,
      accessUntilMs: Date.parse(esperado),
      modules: MODULES_DO_PLANO,
    });
  });

  it("renovacao estende o ciclo pela fatura paga", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );
    await applyGatewayEvent(
      invoiceEvent("evt_3", "invoice.paid", "in_ciclo_2", PERIODO_2_FIM, "2026-10-09T12:00:10.000Z"),
    );

    const esperado = new Date(Date.parse(PERIODO_2_FIM) + 5 * 86_400_000).toISOString();
    expect(subscription()).toMatchObject({ currentPeriodEnd: PERIODO_2_FIM, accessUntil: esperado });
    expect(account()).toMatchObject({ accessUntil: esperado, subscriptionStatus: "ACTIVE" });
    expect(invoice("in_ciclo_2")).toMatchObject({ status: "PAID", amountPaidInCents: 19_900 });
  });

  it("falha de pagamento registra a fatura e mantem o acesso ate o vencimento", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );
    const antes = account().accessUntil;

    await applyGatewayEvent(
      invoiceEvent("evt_3", "invoice.payment_failed", "in_falhou", PERIODO_2_FIM, "2026-10-09T12:00:10.000Z"),
    );

    expect(invoice("in_falhou")).toMatchObject({ status: "PAST_DUE", amountPaidInCents: 0 });
    // Falhar a cobranca nao estende nem encurta: quem move a data e o ciclo.
    expect(account().accessUntil).toBe(antes);

    await applyGatewayEvent(
      subscriptionEvent("evt_4", "customer.subscription.updated", "past_due", PERIODO_1_FIM, "2026-10-09T12:00:20.000Z"),
    );
    expect(account()).toMatchObject({ subscriptionStatus: "PENDING", accessUntil: antes });
  });

  it("cancelamento encerra no fim do ciclo pago, sem tolerancia", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );
    await applyGatewayEvent(
      subscriptionEvent("evt_3", "customer.subscription.deleted", "canceled", PERIODO_1_FIM, "2026-09-20T09:00:00.000Z"),
    );

    expect(subscription()).toMatchObject({ status: "CANCELED", accessUntil: PERIODO_1_FIM });
    expect(account()).toMatchObject({
      subscriptionStatus: "CANCELLED",
      accessUntil: PERIODO_1_FIM,
      accessUntilMs: Date.parse(PERIODO_1_FIM),
    });
  });

  it("reembolso integral do ciclo corrente fecha o acesso na hora; parcial nao", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );
    await applyGatewayEvent(
      invoiceEvent("evt_3", "invoice.paid", "in_1", PERIODO_1_FIM, "2026-09-09T12:00:08.000Z"),
    );
    const acessoAntes = account().accessUntil;

    const parcial = {
      id: "evt_4",
      type: "charge.refunded",
      created: seconds("2026-09-12T10:00:00.000Z"),
      data: { object: { invoice: "in_1", amount_refunded: 5_000 } },
    };
    await applyGatewayEvent(parcial);
    expect(invoice("in_1")).toMatchObject({ status: "PARTIALLY_REFUNDED", amountRefundedInCents: 5_000 });
    expect(account().accessUntil).toBe(acessoAntes);

    const integral = {
      id: "evt_5",
      type: "charge.refunded",
      created: seconds("2026-09-13T10:00:00.000Z"),
      data: { object: { invoice: "in_1", amount_refunded: 19_900 } },
    };
    await applyGatewayEvent(integral);

    expect(invoice("in_1")).toMatchObject({ status: "REFUNDED" });
    expect(account()).toMatchObject({
      subscriptionStatus: "PENDING",
      accessUntil: "2026-09-13T10:00:00.000Z",
    });
  });
});

describe("Idempotencia e ordem dos eventos", () => {
  it("o mesmo evento entregue duas vezes nao estende o acesso duas vezes", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    const renovacao = invoiceEvent("evt_repetido", "invoice.paid", "in_1", PERIODO_1_FIM, "2026-09-09T12:00:08.000Z");
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );

    const primeira = await applyGatewayEvent(renovacao);
    const depois = { ...account() };
    const segunda = await applyGatewayEvent(renovacao);

    expect(primeira.outcome).toBe("APPLIED");
    expect(segunda.outcome).toBe("DUPLICATE");
    expect(account()).toEqual(depois);
  });

  it("evento antigo reentregue depois de um mais novo nao reabre o acesso", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );
    await applyGatewayEvent(
      subscriptionEvent("evt_3", "customer.subscription.deleted", "canceled", PERIODO_1_FIM, "2026-09-20T09:00:00.000Z"),
    );

    // O "active" abaixo foi gerado ANTES do cancelamento e chega depois.
    const atrasado = subscriptionEvent(
      "evt_atrasado",
      "customer.subscription.updated",
      "active",
      PERIODO_2_FIM,
      "2026-09-15T09:00:00.000Z",
    );
    const result = await applyGatewayEvent(atrasado);

    expect(result.outcome).toBe("OUT_OF_ORDER");
    expect(subscription()).toMatchObject({ status: "CANCELED", accessUntil: PERIODO_1_FIM });
    expect(account()).toMatchObject({ subscriptionStatus: "CANCELLED" });
    // O evento descartado fica registrado: descartar em silencio nao e auditavel.
    expect(store.get(paths.platformGatewayEvent("evt_atrasado"))).toMatchObject({
      outcome: "OUT_OF_ORDER",
    });
  });

  it("tipo de evento sem efeito e registrado como ignorado", async () => {
    const result = await applyGatewayEvent({
      id: "evt_irrelevante",
      type: "customer.discount.created",
      created: seconds("2026-09-09T12:00:00.000Z"),
      data: { object: {} },
    });

    expect(result.outcome).toBe("IGNORED");
    expect(store.get(paths.platformGatewayEvent("evt_irrelevante"))).toMatchObject({ outcome: "IGNORED" });
  });
});

describe("Fronteira com o financeiro do assinante", () => {
  it("um ciclo inteiro de cobranca nao escreve nada dentro de organizations/", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );
    await applyGatewayEvent(
      invoiceEvent("evt_3", "invoice.paid", "in_1", PERIODO_1_FIM, "2026-09-09T12:00:08.000Z"),
    );
    await applyGatewayEvent(
      subscriptionEvent("evt_4", "customer.subscription.deleted", "canceled", PERIODO_1_FIM, "2026-09-20T09:00:00.000Z"),
    );

    const dentroDoTenant = [...store.keys()].filter(
      (path) => path.startsWith("organizations/") && path !== paths.organization(ORG),
    );
    expect(dentroDoTenant).toEqual([]);
  });

  it("nunca toca a conta do administrador da plataforma nem a de outra organizacao", async () => {
    store.set(paths.account(USER), { ...account(), platformRole: "PLATFORM_ADMIN" });
    const antes = { ...account() };

    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );

    expect(account()).toEqual(antes);
  });
});

describe("Revisao de seguranca — ordem entre fatura, assinatura e reembolso", () => {
  it("fatura paga gerada antes do cancelamento e entregue depois nao reabre o acesso", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );
    await applyGatewayEvent(
      subscriptionEvent("evt_3", "customer.subscription.deleted", "canceled", PERIODO_1_FIM, "2026-09-20T09:00:00.000Z"),
    );

    // Gerada antes do cancelamento, para um ciclo que a assinatura nunca registrou.
    const result = await applyGatewayEvent(
      invoiceEvent("evt_atrasada", "invoice.paid", "in_atrasada", PERIODO_2_FIM, "2026-09-15T09:00:00.000Z"),
    );

    expect(result.outcome).toBe("APPLIED");
    expect(invoice("in_atrasada")).toMatchObject({ status: "PAID" });
    expect(subscription()).toMatchObject({
      status: "CANCELED",
      accessUntil: PERIODO_1_FIM,
      lastEventAt: "2026-09-20T09:00:00.000Z",
      lastEventId: "evt_3",
    });
    expect(account()).toMatchObject({ subscriptionStatus: "CANCELLED", accessUntil: PERIODO_1_FIM });
  });

  it("fatura mais antiga que o ultimo estado da assinatura nao reescreve esse estado", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );
    await applyGatewayEvent(
      subscriptionEvent("evt_3", "customer.subscription.updated", "past_due", PERIODO_1_FIM, "2026-10-10T12:00:00.000Z"),
    );

    await applyGatewayEvent(
      invoiceEvent("evt_4", "invoice.paid", "in_velha", PERIODO_2_FIM, "2026-10-09T12:00:00.000Z"),
    );

    expect(subscription()).toMatchObject({
      status: "PAST_DUE",
      currentPeriodEnd: PERIODO_1_FIM,
      lastEventAt: "2026-10-10T12:00:00.000Z",
    });
    expect(account()).toMatchObject({ subscriptionStatus: "PENDING" });
  });

  it("reembolso atrasado fecha o acesso sem voltar o carimbo nem desfazer o cancelamento", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );
    await applyGatewayEvent(
      invoiceEvent("evt_3", "invoice.paid", "in_1", PERIODO_1_FIM, "2026-09-09T12:00:08.000Z"),
    );
    await applyGatewayEvent(
      subscriptionEvent("evt_4", "customer.subscription.deleted", "canceled", PERIODO_1_FIM, "2026-09-20T09:00:00.000Z"),
    );

    // `charge.invoice` e o formato anterior a 2025-03-31.basil; a versao fixada
    // nao o envia mais (pendencia S-01 em docs/REVISAO-DE-SEGURANCA-2026-09-10.md).
    await applyGatewayEvent({
      id: "evt_5",
      type: "charge.refunded",
      created: seconds("2026-09-19T09:00:00.000Z"),
      data: { object: { invoice: "in_1", amount_refunded: 19_900 } },
    });

    expect(subscription()).toMatchObject({
      status: "CANCELED",
      accessUntil: "2026-09-19T09:00:00.000Z",
      lastEventAt: "2026-09-20T09:00:00.000Z",
    });
    expect(account()).toMatchObject({ subscriptionStatus: "CANCELLED", accessUntil: "2026-09-19T09:00:00.000Z" });
  });
});

describe("Revisao de seguranca — uma assinatura por organizacao, tambem no gateway", () => {
  it("evento de outra assinatura nao derruba a vigente", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );

    const result = await applyGatewayEvent(
      subscriptionEvent("evt_3", "customer.subscription.deleted", "canceled", PERIODO_1_FIM, "2026-09-20T09:00:00.000Z", {
        id: "sub_duplicada",
      }),
    );

    expect(result.outcome).toBe("REJECTED");
    expect(subscription()).toMatchObject({ status: "ACTIVE", gateway: { subscriptionId: SUBSCRIPTION } });
    expect(account()).toMatchObject({ subscriptionStatus: "ACTIVE" });
  });

  it("fatura de outra assinatura fica registrada, com o campo da versao fixada, e nao estende a vigente", async () => {
    await applyGatewayEvent(checkoutEvent("evt_1"));
    await applyGatewayEvent(
      subscriptionEvent("evt_2", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );

    await applyGatewayEvent(
      invoiceEvent("evt_3", "invoice.paid", "in_outra", PERIODO_2_FIM, "2026-10-09T12:00:00.000Z", {
        subscription: undefined,
        parent: { type: "subscription_details", subscription_details: { subscription: "sub_duplicada", metadata: { organizationId: ORG } } },
      }),
    );

    expect(invoice("in_outra")).toMatchObject({ status: "PAID", subscriptionId: "sub_duplicada" });
    expect(subscription()).toMatchObject({ currentPeriodEnd: PERIODO_1_FIM });
  });

  it("sem vinculo anterior, so o titular da organizacao ativa a assinatura", async () => {
    store.set(paths.organization(ORG), { id: ORG, ownerId: "outro-dono", primaryProfession: "PSYCHOLOGIST" });
    const antes = { ...account() };

    const result = await applyGatewayEvent(
      subscriptionEvent("evt_1", "customer.subscription.created", "active", PERIODO_1_FIM, "2026-09-09T12:00:05.000Z"),
    );

    expect(result.outcome).toBe("REJECTED");
    expect(subscription()).toBeUndefined();
    expect(account()).toEqual(antes);
  });
});

describe("Revisao de seguranca — quem pode pedir pelas callables", () => {
  const MEMBRO = "membro-promovido";
  const chamada = (uid, data = {}) => ({ auth: { uid, token: {} }, data });

  beforeEach(() => {
    // Sem chave do gateway: nenhuma chamada sai daqui. Quem passa da
    // autorizacao termina em `failed-precondition` antes de qualquer rede.
    delete process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_PRICE_MAP = JSON.stringify({ [PLAN]: "price_teste" });
    store.set(paths.account(MEMBRO), {
      userId: MEMBRO,
      platformRole: "PROFESSIONAL",
      organizationId: ORG,
      status: "ACTIVE",
      mustChangePassword: false,
    });
    store.set(paths.platformSubscription(ORG), {
      organizationId: ORG,
      subscriberUserId: USER,
      status: "ACTIVE",
      gateway: { provider: "STRIPE", customerId: CUSTOMER, subscriptionId: SUBSCRIPTION },
    });
  });

  afterEach(() => {
    delete process.env.STRIPE_PRICE_MAP;
  });

  it("OWNER suspenso da organizacao nao abre o portal nem cancela", async () => {
    store.set(paths.document(ORG, "members", MEMBRO), { role: "OWNER", status: "SUSPENDED" });

    await expect(openBillingPortal(chamada(MEMBRO))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(cancelPlatformSubscription(chamada(MEMBRO))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("OWNER ativo que nao e o titular gerencia, mas nao contrata", async () => {
    store.set(paths.document(ORG, "members", MEMBRO), { role: "OWNER", status: "ACTIVE" });

    await expect(openBillingPortal(chamada(MEMBRO))).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(createSubscriptionCheckout(chamada(MEMBRO, { planId: PLAN }))).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("titular com assinatura inadimplente e mandado ao portal, sem abrir uma segunda", async () => {
    store.set(paths.platformSubscription(ORG), { ...subscription(), status: "PAST_DUE" });

    const erro = await createSubscriptionCheckout(chamada(USER, { planId: PLAN })).catch((caught) => caught);

    expect(erro).toMatchObject({ code: "failed-precondition" });
    expect(erro.message).toContain("pendente");
  });
});

describe("Assinatura do webhook", () => {
  const secret = "whsec_apenas_para_o_teste";
  const body = JSON.stringify({ id: "evt_assinado", type: "invoice.paid" });

  it("aceita o corpo integro assinado dentro da janela", () => {
    const header = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(Buffer.from(body), header, secret)).toMatchObject({ id: "evt_assinado" });
  });

  it("recusa corpo adulterado, segredo errado, carimbo velho e cabecalho ausente", () => {
    const header = signWebhookPayload(body, secret);
    const adulterado = JSON.stringify({ id: "evt_assinado", type: "invoice.paid", amount: 1 });

    expect(verifyWebhookSignature(Buffer.from(adulterado), header, secret)).toBeNull();
    expect(verifyWebhookSignature(Buffer.from(body), header, "whsec_outro")).toBeNull();
    expect(verifyWebhookSignature(Buffer.from(body), header, secret, Date.now() + 3_600_000)).toBeNull();
    expect(verifyWebhookSignature(Buffer.from(body), null, secret)).toBeNull();
    expect(verifyWebhookSignature(Buffer.from(body), "t=1,v1=", secret)).toBeNull();
  });

  it("aceita rotacao de segredo com mais de uma assinatura no cabecalho", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const antigo = signWebhookPayload(body, "whsec_antigo", timestamp);
    const novo = signWebhookPayload(body, secret, timestamp);
    const combinado = `${antigo},${novo.slice(novo.indexOf("v1="))}`;

    expect(verifyWebhookSignature(Buffer.from(body), combinado, secret)).toMatchObject({ id: "evt_assinado" });
  });
});

describe("Codificacao do formulario enviado ao gateway", () => {
  it("achata objetos e listas no formato que a API espera", () => {
    const encoded = encodeForm({
      mode: "subscription",
      line_items: [{ price: "price_1", quantity: 1 }],
      metadata: { organizationId: "org-a" },
      vazio: null,
    });

    expect(decodeURIComponent(encoded)).toContain("line_items[0][price]=price_1");
    expect(decodeURIComponent(encoded)).toContain("metadata[organizationId]=org-a");
    expect(encoded).not.toContain("vazio");
  });
});
