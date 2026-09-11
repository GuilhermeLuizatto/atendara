import { createHmac } from "node:crypto";
import { createRequire } from "node:module";

import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut, type Auth } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  terminate,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_ACCESS_GRANT_DAYS } from "@/config/platform";
import { paths } from "@/lib/firebase/paths";
import {
  FUNCTIONS_PORT,
  PROJECT,
  REGION,
  callFunction,
  tokenSession,
  type TokenSession,
} from "@/lib/testing/emulator-session";

/**
 * Etapa 5B: concessao manual registrada, de ponta a ponta.
 *
 * O que `functions/index.test.js` prova caso a caso, esta suite prova com as
 * pecas reais conversando: callables com segundo fator e App Check, transacao
 * do Firestore, webhook assinado e Security Rules decidindo o painel.
 *
 * Rodar com: npm run test:access
 */

const require = createRequire(import.meta.url);
const admin = require("../../../functions/node_modules/firebase-admin/lib/index.js");

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9098";
const [FIRESTORE_HOST, FIRESTORE_PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8087").split(":");
const WEBHOOK_SECRET = "whsec_apenas_para_o_emulador";
const WEBHOOK_URL = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT}/${REGION}/stripeWebhook`;

const OPERATOR_UID = "operadora-das-concessoes";
const TITULAR = { email: "titular-concessao@atendara.test", password: "SenhaDeTeste-Titular-3" };
const REASON = "Piloto combinado com a clinica em 10/09.";

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let operator: TokenSession;
let operatorWithoutFactor: TokenSession;
let operatorWithSms: TokenSession;
let titularUid: string;
let organizationId: string;

const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const inDays = (days: number) => inSeconds(days * 86_400);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function accountOf(uid: string): Promise<Record<string, unknown>> {
  return (await admin.firestore().doc(paths.account(uid)).get()).data();
}

async function auditActions(): Promise<string[]> {
  const entries = await admin.firestore().collection(paths.platformAuditLogs()).where("organizationId", "==", organizationId).get();
  return entries.docs.map((entry: { data(): { action: string } }) => entry.data().action).sort();
}

async function expectDenied(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: "permission-denied" });
}

const tenantClient = () => doc(db, paths.document(organizationId, "clients", "qualquer"));

async function titularCall(name: string, data: unknown) {
  return callFunction(name, data, { idToken: await auth.currentUser!.getIdToken() });
}

/** Assinatura do webhook, reimplementada aqui como na suite de cobranca. */
async function deliver(event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${timestamp},v1=${digest}` },
    body,
  });
  return { status: response.status, ...((await response.json().catch(() => ({}))) as { outcome?: string }) };
}

beforeAll(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = `${FIRESTORE_HOST}:${FIRESTORE_PORT}`;
  admin.initializeApp({ projectId: PROJECT });

  // A operadora so precisa do documento de autoridade: quem entra com TOTP e o
  // token de teste, que o emulador de Auth nao sabe emitir.
  await admin.firestore().doc(paths.account(OPERATOR_UID)).set({
    userId: OPERATOR_UID,
    email: "operadora-concessoes@atendara.test",
    displayName: "Operadora das Concessoes",
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
  operatorWithSms = tokenSession(OPERATOR_UID, "phone");

  app = initializeApp({ projectId: PROJECT, apiKey: "chave-de-emulador" }, "grant-access-tests");
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE_HOST, Number(FIRESTORE_PORT));

  const created = await operator.call<{ userId: string; temporaryPassword: string }>("registerProfessional", {
    displayName: "Titular da Concessao",
    email: TITULAR.email,
    professionId: "PSYCHOLOGIST",
    modules: ["dashboard", "agenda", "clientes"],
  });
  titularUid = created.userId;
  organizationId = (await accountOf(titularUid)).organizationId as string;

  await signInWithEmailAndPassword(auth, TITULAR.email, created.temporaryPassword);
  await titularCall("completeInitialPassword", { password: TITULAR.password });
  await signInWithEmailAndPassword(auth, TITULAR.email, TITULAR.password);
}, 120_000);

afterAll(async () => {
  await signOut(auth).catch(() => {});
  await Promise.all([operator, operatorWithoutFactor, operatorWithSms].map((session) => session.dispose()));
  await terminate(db);
  await deleteApp(app);
  await Promise.all(admin.apps.map((instance: { delete(): Promise<void> }) => instance.delete()));
});

describe("Etapa 5B — concessao manual registrada", () => {
  it("cadastro sem concessao nasce sem acesso", async () => {
    expect(await accountOf(titularUid)).toMatchObject({ subscriptionStatus: "PENDING", accessUntil: null, accessUntilMs: 0 });
    await expectDenied(getDoc(tenantClient()));
  });

  it("so a operadora com TOTP concede ou revoga", async () => {
    const payload = { organizationId, kind: "COURTESY", until: inDays(30), reason: REASON };

    await expect(titularCall("grantAccess", payload)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(titularCall("revokeAccess", { organizationId, reason: REASON })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(operatorWithoutFactor.call("grantAccess", payload)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(operatorWithSms.call("grantAccess", payload)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(callFunction("grantAccess", payload, { idToken: operator.idToken, appCheck: false })).rejects.toMatchObject({ code: "unauthenticated" });

    expect((await admin.firestore().doc(paths.platformAccessGrant(organizationId)).get()).exists).toBe(false);
    await expectDenied(getDoc(tenantClient()));
  });

  it("prazo acima do maximo e recusado", async () => {
    await expect(
      operator.call("grantAccess", { organizationId, kind: "PILOT", until: inDays(MAX_ACCESS_GRANT_DAYS + 1), reason: REASON }),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect((await admin.firestore().doc(paths.platformAccessGrant(organizationId)).get()).exists).toBe(false);
  });

  it("concessao abre o painel e expira sozinha", async () => {
    await operator.call("grantAccess", { organizationId, kind: "PILOT", until: inSeconds(6), reason: REASON });

    await expect(getDoc(tenantClient())).resolves.toBeDefined();

    // Ninguem reescreve a conta no vencimento: a regra compara a validade com
    // o relogio do servidor. A leitura sai de uma CONEXAO NOVA: no emulador, a
    // conexao ja aberta continuou lendo depois do vencimento, e so conexao nova
    // foi recusada.
    await sleep(7_000);
    const later = initializeApp({ projectId: PROJECT, apiKey: "chave-de-emulador" }, "grant-expiry-check");
    const laterAuth = getAuth(later);
    connectAuthEmulator(laterAuth, `http://${AUTH_HOST}`, { disableWarnings: true });
    const laterDb = getFirestore(later);
    connectFirestoreEmulator(laterDb, FIRESTORE_HOST, Number(FIRESTORE_PORT));
    try {
      await signInWithEmailAndPassword(laterAuth, TITULAR.email, TITULAR.password);
      await expectDenied(getDoc(doc(laterDb, paths.document(organizationId, "clients", "qualquer"))));
    } finally {
      await signOut(laterAuth).catch(() => {});
      await terminate(laterDb);
      await deleteApp(later);
    }
  }, 30_000);

  it("evento INCOMPLETE assinado nao fecha a concessao vigente", async () => {
    const until = inDays(30);
    await operator.call("grantAccess", { organizationId, kind: "COURTESY", until, reason: REASON });
    const now = Math.floor(Date.now() / 1000);

    const linked = await deliver({
      id: "evt_concessao_vinculo",
      type: "checkout.session.completed",
      created: now,
      data: {
        object: {
          mode: "subscription",
          customer: "cus_concessao",
          subscription: "sub_concessao",
          client_reference_id: organizationId,
          metadata: { organizationId, subscriberUserId: titularUid, planId: "profissional-mensal" },
        },
      },
    });
    const incomplete = await deliver({
      id: "evt_concessao_incompleta",
      type: "customer.subscription.created",
      created: now + 1,
      data: {
        object: {
          id: "sub_concessao",
          customer: "cus_concessao",
          status: "incomplete",
          cancel_at_period_end: false,
          currency: "brl",
          current_period_start: now,
          current_period_end: now + 30 * 86_400,
          items: { data: [{ price: { unit_amount: 19_900, recurring: { interval: "month" } } }] },
          metadata: { organizationId, subscriberUserId: titularUid, planId: "profissional-mensal" },
        },
      },
    });

    expect(linked).toMatchObject({ status: 200, outcome: "APPLIED" });
    expect(incomplete).toMatchObject({ status: 200, outcome: "APPLIED" });
    expect((await admin.firestore().doc(paths.platformSubscription(organizationId)).get()).data()).toMatchObject({ status: "INCOMPLETE" });
    expect(await accountOf(titularUid)).toMatchObject({ subscriptionStatus: "ACTIVE", accessUntil: until });
    await expect(getDoc(tenantClient())).resolves.toBeDefined();
  });

  it("o titular le a propria concessao; ninguem escreve nela nem na trilha", async () => {
    await expect(getDoc(doc(db, paths.platformAccessGrant(organizationId)))).resolves.toBeDefined();
    await expectDenied(setDoc(doc(db, paths.platformAccessGrant(organizationId)), { organizationId, until: inDays(365) }));
    await expectDenied(getDocs(collection(db, paths.platformAuditLogs())));

    await expectDenied(setDoc(doc(operator.firestore, paths.platformAccessGrant(organizationId)), { organizationId, until: inDays(365) }));
    await expectDenied(setDoc(doc(operator.firestore, paths.platformAuditLog("forjado")), { action: "ACCESS_GRANTED" }));
    await expect(getDocs(collection(operator.firestore, paths.platformAuditLogs()))).resolves.toBeDefined();
    await expectDenied(getDocs(collection(operatorWithoutFactor.firestore, paths.platformAuditLogs())));
  });

  it("revogacao fecha o painel e cada ato fica na trilha", async () => {
    await operator.call("revokeAccess", { organizationId, reason: "Cortesia encerrada antes do prazo." });

    // A assinatura segue INCOMPLETE: sem a concessao, nada abre.
    expect(await accountOf(titularUid)).toMatchObject({ subscriptionStatus: "PENDING", accessUntil: null });
    await expectDenied(getDoc(tenantClient()));
    await expect(operator.call("revokeAccess", { organizationId, reason: "Segunda revogacao da mesma." })).rejects.toMatchObject({
      code: "failed-precondition",
    });

    expect(await auditActions()).toEqual(["ACCESS_GRANTED", "ACCESS_GRANTED", "ACCESS_REVOKED", "ACCOUNT_REGISTERED"]);
  });
});
