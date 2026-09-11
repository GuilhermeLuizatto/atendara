import { createHmac } from "node:crypto";
import { createRequire } from "node:module";

import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  terminate,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GRACE_PERIOD_DAYS } from "@/config/billing";
import { paths } from "@/lib/firebase/paths";
import { callFunction, tokenSession, type TokenSession } from "@/lib/testing/emulator-session";

/**
 * Etapa 3: a cobranca da plataforma, provada de ponta a ponta.
 *
 * A suite de `functions/billing.test.js` testa a decisao caso a caso, com o
 * banco em memoria. Esta aqui testa o que aquela nao alcanca: o webhook HTTP de
 * verdade, a verificacao da assinatura no meio do caminho, a transacao real do
 * Firestore e as Security Rules reais decidindo quem le o que.
 *
 * A assinatura do webhook e recalculada aqui do zero, com `node:crypto`, em vez
 * de reaproveitar a funcao do backend. Se as duas compartilhassem a
 * implementacao, um erro nela passaria despercebido pelos dois lados.
 *
 * Nenhuma cobranca real acontece: `STRIPE_SECRET_KEY` nao existe neste
 * ambiente (ver `scripts/run-access-tests.mjs`), entao nenhuma chamada sai
 * daqui para o gateway. O que entra e um evento que nos mesmos assinamos.
 *
 * Rodar com: npm run test:access
 */

const require = createRequire(import.meta.url);
const PROJECT = "demo-atendara";
const REGION = "southamerica-east1";
const FUNCTIONS_PORT = 5002;
const OPERATOR_UID = "operadora-da-cobranca";
const WEBHOOK_SECRET = "whsec_apenas_para_o_emulador";
const WEBHOOK_URL = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT}/${REGION}/stripeWebhook`;

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9098";
const [FIRESTORE_HOST, FIRESTORE_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8087"
).split(":");

const OWNER = { email: "assinante@atendara.test", password: "SenhaDeTeste-Assinante-2" };
const NEIGHBOUR = { email: "vizinho@atendara.test", password: "SenhaDeTeste-Vizinho-2" };
const EMPLOYEE = { email: "secretaria@atendara.test", password: "SenhaDeTeste-Secretaria-1" };

const PLAN = "profissional-mensal";
const CUSTOMER = "cus_assinante";
const SUBSCRIPTION = "sub_assinante";
const PERIOD_1_END = "2026-10-09T12:00:00.000Z";
const PERIOD_2_END = "2026-11-09T12:00:00.000Z";

const admin = require("../../../functions/node_modules/firebase-admin/lib/index.js");

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
/** Operadora com TOTP, e a mesma conta sem o fator. */
let operator: TokenSession;
let operatorWithoutFactor: TokenSession;

let ownerUid: string;
let ownerOrg: string;
let neighbourUid: string;
let neighbourOrg: string;

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const withGrace = (iso: string) =>
  new Date(Date.parse(iso) + GRACE_PERIOD_DAYS * 86_400_000).toISOString();

/** Assinatura do webhook, reimplementada aqui de proposito. */
function sign(body: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

async function deliver(
  event: Record<string, unknown>,
  options: { secret?: string; header?: string } = {},
): Promise<{ status: number; outcome?: string }> {
  const body = JSON.stringify(event);
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": options.header ?? sign(body, options.secret),
    },
    body,
  });
  const text = await response.text();
  let outcome: string | undefined;
  try {
    outcome = (JSON.parse(text) as { outcome?: string }).outcome;
  } catch {
    outcome = undefined;
  }
  return { status: response.status, outcome };
}

function checkoutCompleted(id: string, createdIso: string) {
  return {
    id,
    type: "checkout.session.completed",
    created: unix(createdIso),
    data: {
      object: {
        mode: "subscription",
        customer: CUSTOMER,
        subscription: SUBSCRIPTION,
        client_reference_id: ownerOrg,
        metadata: { organizationId: ownerOrg, subscriberUserId: ownerUid, planId: PLAN },
      },
    },
  };
}

function subscriptionEvent(
  id: string,
  type: string,
  status: string,
  periodEnd: string,
  createdIso: string,
) {
  return {
    id,
    type,
    created: unix(createdIso),
    data: {
      object: {
        id: SUBSCRIPTION,
        customer: CUSTOMER,
        status,
        cancel_at_period_end: false,
        currency: "brl",
        current_period_start: unix("2026-09-09T12:00:00.000Z"),
        current_period_end: unix(periodEnd),
        items: { data: [{ price: { unit_amount: 19_900, recurring: { interval: "month" } } }] },
        metadata: { organizationId: ownerOrg, subscriberUserId: ownerUid, planId: PLAN },
      },
    },
  };
}

function invoiceEvent(
  id: string,
  type: string,
  invoiceId: string,
  periodEnd: string,
  createdIso: string,
) {
  return {
    id,
    type,
    created: unix(createdIso),
    data: {
      object: {
        id: invoiceId,
        customer: CUSTOMER,
        subscription: SUBSCRIPTION,
        currency: "brl",
        amount_due: 19_900,
        amount_paid: type === "invoice.paid" ? 19_900 : 0,
        created: unix(createdIso),
        hosted_invoice_url: `https://exemplo.invalido/${invoiceId}`,
        lines: {
          data: [{ period: { start: unix("2026-09-09T12:00:00.000Z"), end: unix(periodEnd) } }],
        },
        subscription_details: { metadata: { organizationId: ownerOrg } },
      },
    },
  };
}

async function accountOf(uid: string): Promise<Record<string, unknown>> {
  return (await admin.firestore().doc(paths.account(uid)).get()).data() as Record<string, unknown>;
}

async function subscriptionOf(org: string): Promise<Record<string, unknown> | undefined> {
  const snapshot = await admin.firestore().doc(paths.platformSubscription(org)).get();
  return snapshot.data() as Record<string, unknown> | undefined;
}

async function expectDenied(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: "permission-denied" });
}

/** Callable com a sessao atual do Auth do emulador. */
async function callAsSignedIn(name: string, data: unknown): Promise<unknown> {
  return callFunction(name, data, { idToken: await auth.currentUser!.getIdToken() });
}

/**
 * Cadastra pelo caminho oficial e ja troca a senha inicial. Sem concessao: a
 * conta nasce pendente, e a liberacao tem que vir da cobranca.
 */
async function register(
  person: { email: string; password: string },
  displayName: string,
): Promise<{ uid: string; organizationId: string }> {
  const result = await operator.call<{ userId: string; temporaryPassword: string }>("registerProfessional", {
    displayName,
    email: person.email,
    professionId: "PSYCHOLOGIST",
    modules: ["dashboard", "agenda", "clientes"],
  });

  await signInWithEmailAndPassword(auth, person.email, result.temporaryPassword);
  await callAsSignedIn("completeInitialPassword", { password: person.password });
  await signInWithEmailAndPassword(auth, person.email, person.password);

  const account = await accountOf(result.userId);
  return { uid: result.userId, organizationId: account.organizationId as string };
}

beforeAll(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = `${FIRESTORE_HOST}:${FIRESTORE_PORT}`;
  admin.initializeApp({ projectId: PROJECT });

  await admin.firestore().doc(paths.account(OPERATOR_UID)).set({
    userId: OPERATOR_UID,
    email: "operadora@atendara.test",
    displayName: "Operadora de Teste",
    platformRole: "PLATFORM_ADMIN",
    professionId: null,
    organizationId: null,
    modules: [],
    status: "ACTIVE",
    mustChangePassword: false,
    createdAt: new Date().toISOString(),
  });
  operator = tokenSession(OPERATOR_UID, "totp");
  operatorWithoutFactor = tokenSession(OPERATOR_UID, null);

  app = initializeApp({ projectId: PROJECT, apiKey: "chave-de-emulador" }, "billing-access-tests");
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE_HOST, Number(FIRESTORE_PORT));

  const owner = await register(OWNER, "Assinante de Teste");
  ownerUid = owner.uid;
  ownerOrg = owner.organizationId;

  const neighbour = await register(NEIGHBOUR, "Vizinho de Teste");
  neighbourUid = neighbour.uid;
  neighbourOrg = neighbour.organizationId;

  // Membro da organizacao do assinante que NAO responde por ela. Existe para
  // provar que a cobranca e do dono, e nao de qualquer pessoa do time.
  const employee = await admin.auth().createUser({
    email: EMPLOYEE.email,
    password: EMPLOYEE.password,
    displayName: "Secretaria de Teste",
  });
  await admin.firestore().doc(paths.account(employee.uid)).set({
    userId: employee.uid,
    email: EMPLOYEE.email,
    displayName: "Secretaria de Teste",
    platformRole: "PROFESSIONAL",
    professionId: "PSYCHOLOGIST",
    organizationId: ownerOrg,
    modules: ["dashboard", "agenda", "clientes"],
    status: "ACTIVE",
    subscriptionStatus: "ACTIVE",
    accessUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    accessUntilMs: Date.now() + 30 * 86_400_000,
    mustChangePassword: false,
    createdAt: new Date().toISOString(),
  });
  await admin
    .firestore()
    .doc(paths.document(ownerOrg, "members", employee.uid))
    .set({ id: employee.uid, userId: employee.uid, organizationId: ownerOrg, role: "ASSISTANT", status: "ACTIVE" });
}, 120_000);

afterAll(async () => {
  await signOut(auth).catch(() => {});
  await operator.dispose();
  await operatorWithoutFactor.dispose();
  await terminate(db);
  await deleteApp(app);
  await Promise.all(admin.apps.map((instance: { delete(): Promise<void> }) => instance.delete()));
});

describe("Etapa 3 — o webhook e a unica autoridade", () => {
  it("recusa evento sem assinatura valida e nao grava nada", async () => {
    const event = subscriptionEvent("evt_forjado", "customer.subscription.created", "active", PERIOD_1_END, new Date().toISOString());

    expect((await deliver(event, { secret: "whsec_errado" })).status).toBe(400);
    expect((await deliver(event, { header: "t=1,v1=deadbeef" })).status).toBe(400);
    expect((await deliver(event, { header: "" })).status).toBe(400);

    const registro = await admin.firestore().doc(paths.platformGatewayEvent("evt_forjado")).get();
    expect(registro.exists).toBe(false);
    expect(await subscriptionOf(ownerOrg)).toBeUndefined();
    // E o painel continua fechado.
    expect(await accountOf(ownerUid)).toMatchObject({ subscriptionStatus: "PENDING" });
  });

  it("recusa carimbo fora da janela de tolerancia", async () => {
    const body = JSON.stringify(
      subscriptionEvent("evt_antigo", "customer.subscription.created", "active", PERIOD_1_END, new Date().toISOString()),
    );
    const velho = sign(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3_600);

    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": velho },
      body,
    });
    expect(response.status).toBe(400);
  });

  it("o checkout concluido associa, mas nao abre o painel", async () => {
    const result = await deliver(checkoutCompleted("evt_vinculo", "2026-09-09T12:00:00.000Z"));
    expect(result).toMatchObject({ status: 200, outcome: "APPLIED" });

    expect(await subscriptionOf(ownerOrg)).toMatchObject({
      organizationId: ownerOrg,
      subscriberUserId: ownerUid,
      status: "INCOMPLETE",
      accessUntil: null,
    });
    const conta = await accountOf(ownerUid);
    expect(conta).toMatchObject({ subscriptionStatus: "PENDING" });
    expect(conta.accessUntilMs as number).toBeLessThan(Date.now());

    // Voltar do checkout nao muda nada: o painel do assinante segue fechado.
    await signInWithEmailAndPassword(auth, OWNER.email, OWNER.password);
    await expectDenied(getDoc(doc(db, paths.document(ownerOrg, "clients", "qualquer"))));
  });

  it("a assinatura ativa abre o painel e libera os modulos do plano", async () => {
    const result = await deliver(
      subscriptionEvent("evt_ativa", "customer.subscription.created", "active", PERIOD_1_END, "2026-09-09T12:00:05.000Z"),
    );
    expect(result).toMatchObject({ status: 200, outcome: "APPLIED" });

    const esperado = withGrace(PERIOD_1_END);
    expect(await subscriptionOf(ownerOrg)).toMatchObject({ status: "ACTIVE", accessUntil: esperado });
    const account = await accountOf(ownerUid);
    expect(account).toMatchObject({
      subscriptionStatus: "ACTIVE",
      accessUntil: esperado,
      accessUntilMs: Date.parse(esperado),
    });
    // O plano libera financeiro, que o cadastro nao tinha concedido.
    expect(account.modules).toContain("financeiro");

    await signInWithEmailAndPassword(auth, OWNER.email, OWNER.password);
    await expect(
      getDoc(doc(db, paths.document(ownerOrg, "clients", "qualquer"))),
    ).resolves.toBeDefined();
  });

  it("a renovacao paga estende o ciclo e registra a fatura", async () => {
    await deliver(invoiceEvent("evt_fatura_1", "invoice.paid", "in_ciclo_1", PERIOD_1_END, "2026-09-09T12:00:08.000Z"));
    const result = await deliver(
      invoiceEvent("evt_fatura_2", "invoice.paid", "in_ciclo_2", PERIOD_2_END, "2026-10-09T12:00:00.000Z"),
    );
    expect(result).toMatchObject({ status: 200, outcome: "APPLIED" });

    const esperado = withGrace(PERIOD_2_END);
    expect(await accountOf(ownerUid)).toMatchObject({ accessUntil: esperado, subscriptionStatus: "ACTIVE" });

    const fatura = await admin.firestore().doc(paths.platformInvoice("in_ciclo_2")).get();
    expect(fatura.data()).toMatchObject({
      organizationId: ownerOrg,
      status: "PAID",
      amountDueInCents: 19_900,
      amountPaidInCents: 19_900,
    });
  });

  it("o mesmo evento reentregue nao estende o acesso de novo", async () => {
    const antes = await accountOf(ownerUid);
    const repetido = invoiceEvent("evt_fatura_2", "invoice.paid", "in_ciclo_2", PERIOD_2_END, "2026-10-09T12:00:00.000Z");

    const result = await deliver(repetido);

    expect(result).toMatchObject({ status: 200, outcome: "DUPLICATE" });
    expect(await accountOf(ownerUid)).toMatchObject({ accessUntil: antes.accessUntil });
  });

  it("evento anterior ao ultimo aplicado e registrado e descartado", async () => {
    const antes = await subscriptionOf(ownerOrg);
    const atrasado = subscriptionEvent(
      "evt_atrasado",
      "customer.subscription.updated",
      "active",
      "2027-01-01T00:00:00.000Z",
      "2026-09-09T12:00:01.000Z",
    );

    const result = await deliver(atrasado);

    expect(result).toMatchObject({ status: 200, outcome: "OUT_OF_ORDER" });
    expect(await subscriptionOf(ownerOrg)).toMatchObject({
      currentPeriodEnd: antes?.currentPeriodEnd,
      accessUntil: antes?.accessUntil,
    });
    expect(
      (await admin.firestore().doc(paths.platformGatewayEvent("evt_atrasado")).get()).data(),
    ).toMatchObject({ outcome: "OUT_OF_ORDER" });
  });

  it("falha de pagamento marca a fatura e mantem o acesso ate o vencimento", async () => {
    const antes = await accountOf(ownerUid);

    await deliver(invoiceEvent("evt_falha", "invoice.payment_failed", "in_falhou", PERIOD_2_END, "2026-11-09T12:00:00.000Z"));
    await deliver(
      subscriptionEvent("evt_atraso", "customer.subscription.updated", "past_due", PERIOD_2_END, "2026-11-09T12:00:10.000Z"),
    );

    expect(
      (await admin.firestore().doc(paths.platformInvoice("in_falhou")).get()).data(),
    ).toMatchObject({ status: "PAST_DUE" });
    // Inadimplencia recente nao derruba o atendimento: a data e a mesma.
    expect(await accountOf(ownerUid)).toMatchObject({
      subscriptionStatus: "PENDING",
      accessUntil: antes.accessUntil,
    });
  });
});

describe("Etapa 3 — quem enxerga e quem escreve", () => {
  it("o assinante le a propria cobranca e nao a do vizinho", async () => {
    await signInWithEmailAndPassword(auth, OWNER.email, OWNER.password);

    await expect(
      getDoc(doc(db, paths.platformSubscription(ownerOrg))),
    ).resolves.toBeDefined();
    await expect(
      getDocs(
        query(
          collection(db, paths.platformInvoices()),
          where("organizationId", "==", ownerOrg),
        ),
      ),
    ).resolves.toBeDefined();

    await expectDenied(getDoc(doc(db, paths.platformSubscription(neighbourOrg))));
    await expectDenied(
      getDocs(
        query(
          collection(db, paths.platformInvoices()),
          where("organizationId", "==", neighbourOrg),
        ),
      ),
    );
    // Sem o filtro de tenant a consulta inteira e recusada.
    await expectDenied(getDocs(collection(db, paths.platformInvoices())));
    await expectDenied(getDocs(collection(db, paths.platformGatewayEvents())));
  });

  it("membro que nao responde pela organizacao nao alcanca a cobranca dela", async () => {
    await signInWithEmailAndPassword(auth, EMPLOYEE.email, EMPLOYEE.password);
    await expectDenied(getDoc(doc(db, paths.platformSubscription(ownerOrg))));
    await expect(
      callAsSignedIn("createSubscriptionCheckout", { planId: PLAN }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("o navegador nao ativa assinatura nem estende a propria validade", async () => {
    await signInWithEmailAndPassword(auth, OWNER.email, OWNER.password);

    await expectDenied(
      setDoc(doc(db, paths.platformSubscription(ownerOrg)), {
        organizationId: ownerOrg,
        status: "ACTIVE",
        accessUntil: "2099-01-01T00:00:00.000Z",
      }),
    );
    await expectDenied(
      updateDoc(doc(db, paths.platformSubscription(ownerOrg)), {
        accessUntil: "2099-01-01T00:00:00.000Z",
      }),
    );
    await expectDenied(
      setDoc(doc(db, paths.platformInvoice("in_forjada")), {
        organizationId: ownerOrg,
        status: "PAID",
        amountPaidInCents: 19_900,
      }),
    );
    await expectDenied(
      setDoc(doc(db, paths.platformGatewayEvent("evt_forjado_pelo_cliente")), {
        outcome: "APPLIED",
      }),
    );
    await expectDenied(
      updateDoc(doc(db, paths.account(ownerUid)), { accessUntilMs: Date.now() + 86_400_000 }),
    );
  });

  it("a operadora com TOTP enxerga a cobranca e mesmo assim nao escreve", async () => {
    const operatorDb = operator.firestore;

    await expect(getDocs(collection(operatorDb, paths.platformSubscriptions()))).resolves.toBeDefined();
    await expect(getDocs(collection(operatorDb, paths.platformInvoices()))).resolves.toBeDefined();
    await expect(getDocs(collection(operatorDb, paths.platformGatewayEvents()))).resolves.toBeDefined();

    await expectDenied(
      updateDoc(doc(operatorDb, paths.platformSubscription(ownerOrg)), { status: "ACTIVE" }),
    );
    // Nem o indice que amarra cliente do gateway e organizacao.
    await expectDenied(getDoc(doc(operatorDb, paths.platformCustomer(CUSTOMER))));
    // Nem o financeiro do assinante, que nunca foi da operadora.
    await expectDenied(getDoc(doc(operatorDb, paths.document(ownerOrg, "transactions", "qualquer"))));

    // Sem o segundo fator, a mesma conta nao e a operadora.
    await expectDenied(getDocs(collection(operatorWithoutFactor.firestore, paths.platformSubscriptions())));
  });

  it("o checkout recusa sem chave do gateway, e nenhuma cobranca sai daqui", async () => {
    await signInWithEmailAndPassword(auth, OWNER.email, OWNER.password);

    await expect(
      callAsSignedIn("createSubscriptionCheckout", { planId: PLAN }),
    ).rejects.toMatchObject({ code: "failed-precondition" });

    await expect(
      callAsSignedIn("createSubscriptionCheckout", { planId: "plano-que-nao-existe" }),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("sem atestado do App Check o checkout nem chega a ser avaliado", async () => {
    await signInWithEmailAndPassword(auth, OWNER.email, OWNER.password);

    await expect(
      callFunction("createSubscriptionCheckout", { planId: PLAN }, { idToken: await auth.currentUser!.getIdToken(), appCheck: false }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("o vizinho nao consegue direcionar a cobranca para a organizacao alheia", async () => {
    // O evento declara a organizacao do assinante, mas o assinante declarado e
    // o vizinho. O backend confere as duas pontas contra o proprio banco.
    const desvio = {
      id: "evt_desvio",
      type: "checkout.session.completed",
      created: unix("2026-09-09T13:00:00.000Z"),
      data: {
        object: {
          mode: "subscription",
          customer: "cus_vizinho",
          subscription: "sub_vizinho",
          client_reference_id: ownerOrg,
          metadata: { organizationId: ownerOrg, subscriberUserId: neighbourUid, planId: PLAN },
        },
      },
    };

    const result = await deliver(desvio);

    expect(result).toMatchObject({ status: 200, outcome: "REJECTED" });
    expect(await subscriptionOf(neighbourOrg)).toBeUndefined();
    expect(await subscriptionOf(ownerOrg)).toMatchObject({ subscriberUserId: ownerUid });
  });
});

describe("Etapa 3 — encerramento", () => {
  it("o reembolso integral do ciclo corrente fecha o acesso na hora", async () => {
    // A fatura do ciclo corrente e a `in_ciclo_2`, ja paga.
    const result = await deliver({
      id: "evt_reembolso",
      type: "charge.refunded",
      created: unix("2026-11-10T09:00:00.000Z"),
      data: { object: { invoice: "in_ciclo_2", amount_refunded: 19_900 } },
    });
    expect(result).toMatchObject({ status: 200, outcome: "APPLIED" });

    expect(
      (await admin.firestore().doc(paths.platformInvoice("in_ciclo_2")).get()).data(),
    ).toMatchObject({ status: "REFUNDED", amountRefundedInCents: 19_900 });
    expect(await accountOf(ownerUid)).toMatchObject({
      subscriptionStatus: "PENDING",
      accessUntil: "2026-11-10T09:00:00.000Z",
    });

    await signInWithEmailAndPassword(auth, OWNER.email, OWNER.password);
    await expectDenied(getDoc(doc(db, paths.document(ownerOrg, "clients", "qualquer"))));
    // Mas continua enxergando a propria cobranca — e por onde ele regulariza.
    await expect(getDoc(doc(db, paths.platformSubscription(ownerOrg)))).resolves.toBeDefined();
  });

  it("o cancelamento encerra no fim do ciclo pago e fecha o painel", async () => {
    const result = await deliver(
      subscriptionEvent("evt_cancelada", "customer.subscription.deleted", "canceled", PERIOD_2_END, "2026-11-11T09:00:00.000Z"),
    );
    expect(result).toMatchObject({ status: 200, outcome: "APPLIED" });

    expect(await subscriptionOf(ownerOrg)).toMatchObject({
      status: "CANCELED",
      accessUntil: PERIOD_2_END,
    });
    expect(await accountOf(ownerUid)).toMatchObject({
      subscriptionStatus: "CANCELLED",
      accessUntil: PERIOD_2_END,
    });

    await signInWithEmailAndPassword(auth, OWNER.email, OWNER.password);
    await expectDenied(getDoc(doc(db, paths.document(ownerOrg, "clients", "qualquer"))));
  });

  it("a cobranca da plataforma nao deixou rastro no financeiro do assinante", async () => {
    const transacoes = await admin
      .firestore()
      .collection(paths.collection(ownerOrg, "transactions"))
      .get();

    expect(transacoes.empty).toBe(true);
  });
});
