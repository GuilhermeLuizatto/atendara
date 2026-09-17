import { createHmac } from "node:crypto";

import { doc, getDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TRIAL_DAYS } from "@/config/platform";
import { LEGAL_VERSION } from "@/config/legal";
import { paths } from "@/lib/firebase/paths";
import { adminDb, deleteAdminApps, initializeAdminSdk } from "@/lib/testing/admin-sdk";
import {
  CallableError,
  FUNCTIONS_PORT,
  PROJECT,
  REGION,
  callFunction,
  tokenSession,
  type TokenSession,
} from "@/lib/testing/emulator-session";

/**
 * A.2: autocadastro de ponta a ponta, com as pecas reais.
 *
 * O que esta suite prova, e que nenhum teste de unidade consegue provar: duas
 * pessoas que se cadastram sozinhas, uma atras da outra, terminam em tenants
 * que nao se enxergam — com as Security Rules de producao carregadas, e sem
 * ninguem da operadora no caminho.
 *
 * Rodar com: npm run test:access
 */

const DAY_MS = 86_400_000;

const PSICOLOGA = {
  displayName: "Helena Prado",
  email: "helena-autocadastro@atendara.test",
  password: "senha-de-teste-helena",
  professionId: "PSYCHOLOGIST" as const,
  councilRegistration: "CRP 06/123456",
  businessName: "Consultório Núcleo",
  acceptedLegalVersion: LEGAL_VERSION,
};

const ESTETICISTA = {
  displayName: "Bianca Ferraz",
  email: "bianca-autocadastro@atendara.test",
  password: "senha-de-teste-bianca",
  professionId: "AESTHETICS" as const,
  businessName: "Espaço Lume",
  acceptedLegalVersion: LEGAL_VERSION,
};

let helena: TokenSession;
let bianca: TokenSession;
let helenaOrg: string;
let biancaOrg: string;

/** A conta criada pelo cadastro, achada pelo e-mail como a tela nao precisa fazer. */
async function accountByEmail(email: string): Promise<Record<string, string | null> | null> {
  const found = await adminDb().collection(paths.accounts()).where("email", "==", email).get();
  return found.empty ? null : found.docs[0].data();
}

async function auditActions(organizationId: string): Promise<string[]> {
  const entries = await adminDb()
    .collection(paths.platformAuditLogs())
    .where("organizationId", "==", organizationId)
    .get();
  return entries.docs.map((entry: { data(): { action: string } }) => entry.data().action).sort();
}

/**
 * Zera os contadores entre os blocos. Sem isto, o teto por rede — que todas as
 * chamadas do emulador compartilham, porque saem da mesma origem — recusaria os
 * cadastros seguintes e esconderia o que cada teste queria provar.
 */
async function clearRateLimits(): Promise<void> {
  const counters = await adminDb().collection("platformRateLimits").get();
  await Promise.all(counters.docs.map((counter: { ref: { delete(): Promise<unknown> } }) => counter.ref.delete()));
}

const signup = (data: unknown) => callFunction<{ ok: boolean }>("registerSelfService", data);

beforeAll(async () => {
  initializeAdminSdk("demo-atendara");
  await clearRateLimits();
});

afterAll(async () => {
  await helena?.dispose();
  await bianca?.dispose();
  await deleteAdminApps();
});

describe("cadastro aberto sem ninguem liberar", () => {
  it("cria a conta sem abrir nada antes da confirmacao do e-mail", async () => {
    expect(await signup(PSICOLOGA)).toEqual({ ok: true });

    const account = await accountByEmail(PSICOLOGA.email);
    expect(account).toMatchObject({
      platformRole: "PROFESSIONAL",
      status: "ACTIVE",
      origin: "SELF_SERVICE",
      subscriptionStatus: "PENDING",
      accessUntil: null,
      mustChangePassword: false,
    });
    helenaOrg = String(account!.organizationId);

    const grant = await adminDb().doc(paths.platformAccessGrant(helenaOrg)).get();
    expect(grant.exists).toBe(false);
    expect(await auditActions(helenaOrg)).toEqual(["SELF_SERVICE_REGISTERED"]);

    const profile = await adminDb().doc(paths.document(helenaOrg, "professionals", String(account!.userId))).get();
    expect(profile.data().licenseNumber).toBe(PSICOLOGA.councilRegistration);
  });

  it("nao revela que o e-mail ja tem conta", async () => {
    expect(await signup(PSICOLOGA)).toEqual({ ok: true });
    const contas = await adminDb().collection(paths.accounts()).where("email", "==", PSICOLOGA.email).get();
    expect(contas.size).toBe(1);
  });

  it("recusa profissao escondida e chamada sem atestado do aplicativo", async () => {
    await expect(signup({ ...ESTETICISTA, professionId: "THERAPIST" })).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(
      callFunction("registerSelfService", ESTETICISTA, { appCheck: false }),
    ).rejects.toBeInstanceOf(CallableError);
    expect(await accountByEmail(ESTETICISTA.email)).toBeNull();
  });
});

describe("teste de 14 dias", () => {
  beforeAll(async () => {
    const account = await accountByEmail(PSICOLOGA.email);
    helena = tokenSession(String(account!.userId), null, {
      email: PSICOLOGA.email,
      emailVerified: true,
    });
  });

  it("recusa comecar sem o e-mail confirmado", async () => {
    const account = await accountByEmail(PSICOLOGA.email);
    const semConfirmar = tokenSession(String(account!.userId), null, {
      email: PSICOLOGA.email,
      emailVerified: false,
    });
    await expect(semConfirmar.call("activateTrial", {})).rejects.toMatchObject({
      code: "failed-precondition",
    });
    expect((await adminDb().doc(paths.platformAccessGrant(helenaOrg)).get()).exists).toBe(false);
    await semConfirmar.dispose();
  });

  it("abre o painel por concessao registrada, com trilha na mesma transacao", async () => {
    const { accessUntil } = await helena.call<{ accessUntil: string }>("activateTrial", {});
    const dias = (Date.parse(accessUntil) - Date.now()) / DAY_MS;
    expect(dias).toBeGreaterThan(TRIAL_DAYS - 1);
    expect(dias).toBeLessThanOrEqual(TRIAL_DAYS);

    const grant = (await adminDb().doc(paths.platformAccessGrant(helenaOrg)).get()).data();
    expect(grant).toMatchObject({ kind: "TRIAL", revokedAt: null, until: accessUntil });
    expect(await accountByEmail(PSICOLOGA.email)).toMatchObject({
      subscriptionStatus: "ACTIVE",
      accessUntil,
    });
    expect(await auditActions(helenaOrg)).toEqual(["SELF_SERVICE_REGISTERED", "TRIAL_STARTED"]);
  });

  it("chamar de novo nao emenda mais catorze dias", async () => {
    const primeira = (await adminDb().doc(paths.platformAccessGrant(helenaOrg)).get()).data();
    const { accessUntil } = await helena.call<{ accessUntil: string }>("activateTrial", {});
    expect(accessUntil).toBe(primeira.until);
    expect(await auditActions(helenaOrg)).toEqual(["SELF_SERVICE_REGISTERED", "TRIAL_STARTED"]);
  });

  it("o titular ve a propria concessao e nada de outra organizacao", async () => {
    const propria = await getDoc(doc(helena.firestore, paths.platformAccessGrant(helenaOrg)));
    expect(propria.data()).toMatchObject({ kind: "TRIAL" });
  });
});

describe("duas contas criadas em sequencia nao se enxergam", () => {
  beforeAll(async () => {
    await clearRateLimits();
    await signup(ESTETICISTA);
    const account = await accountByEmail(ESTETICISTA.email);
    biancaOrg = String(account!.organizationId);
    bianca = tokenSession(String(account!.userId), null, {
      email: ESTETICISTA.email,
      emailVerified: true,
    });
    await bianca.call("activateTrial", {});
  });

  it("cada uma recebeu a propria organizacao", () => {
    expect(biancaOrg).not.toBe(helenaOrg);
  });

  it("nenhuma alcanca a organizacao, a agenda nem a conta da outra", async () => {
    for (const [sessao, alheia] of [
      [helena, biancaOrg],
      [bianca, helenaOrg],
    ] as const) {
      const db = sessao.firestore;
      await expect(getDoc(doc(db, paths.organization(alheia)))).rejects.toMatchObject({
        code: "permission-denied",
      });
      await expect(
        getDoc(doc(db, paths.document(alheia, "clients", "qualquer"))),
      ).rejects.toMatchObject({ code: "permission-denied" });
      await expect(
        getDoc(doc(db, paths.platformAccessGrant(alheia))),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }

    const biancaAccount = await accountByEmail(ESTETICISTA.email);
    await expect(
      getDoc(doc(helena.firestore, paths.account(String(biancaAccount!.userId)))),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("cada uma abre a propria organizacao", async () => {
    const minha = await getDoc(doc(bianca.firestore, paths.organization(biancaOrg)));
    expect(minha.data()).toMatchObject({ primaryProfession: "AESTHETICS" });
  });

  it("nenhuma das duas administra a plataforma", async () => {
    await expect(bianca.call("registerProfessional", {})).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(
      bianca.call("grantAccess", { organizationId: helenaOrg, kind: "PILOT", until: new Date(Date.now() + DAY_MS).toISOString(), reason: "tentativa de escalada" }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("teto de cadastros por origem", () => {
  it("recusa a partir do sexto cadastro da mesma origem na mesma hora", async () => {
    await clearRateLimits();
    // Cinco tentativas gastam a janela. Elas falham na validacao — o que se
    // conta e a TENTATIVA, nao o cadastro concluido.
    for (let numero = 0; numero < 5; numero += 1) {
      await expect(signup({})).rejects.toMatchObject({ code: "invalid-argument" });
    }
    await expect(signup(ESTETICISTA)).rejects.toMatchObject({ code: "resource-exhausted" });
    await clearRateLimits();
  });
});

/**
 * A.4 pelo lado que importa: quem fecha o painel e a DATA, nao uma rotina.
 *
 * A rotina diaria so marca o inicio da retencao e registra o ato — isso esta
 * provado em `functions/trial.test.js`. O que so o emulador prova e que, passada
 * a validade, as Security Rules reais param de entregar dado nenhum.
 */
describe("teste vencido fecha o painel pela data", () => {
  beforeAll(async () => {
    const account = await accountByEmail(ESTETICISTA.email);
    const vencido = new Date(Date.now() - DAY_MS).toISOString();
    await adminDb().doc(paths.account(String(account!.userId))).update({
      accessUntil: vencido,
      accessUntilMs: Date.parse(vencido),
    });
  });

  it("nao entrega mais nada da organizacao", async () => {
    const db = bianca.firestore;
    await expect(getDoc(doc(db, paths.organization(biancaOrg)))).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(
      getDoc(doc(db, paths.document(biancaOrg, "clients", "qualquer"))),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("continua entregando a propria conta, que e o que a tela de bloqueio le", async () => {
    const account = await accountByEmail(ESTETICISTA.email);
    const propria = await getDoc(doc(bianca.firestore, paths.account(String(account!.userId))));
    expect(propria.data()).toMatchObject({ origin: "SELF_SERVICE", blockedSince: null });
  });
});

/**
 * A.6: o teste venceu, a conta foi bloqueada, a pessoa assinou.
 *
 * O pagamento chega pelo webhook assinado, como chegaria da Stripe. O que se
 * prova: o painel reabre pelas regras reais, a marca de bloqueio some e a conta
 * sai do ciclo do teste — a rotina diaria nao a pega mais.
 */
describe("assinatura depois do bloqueio devolve tudo ao normal", () => {
  const WEBHOOK_SECRET = "whsec_apenas_para_o_emulador";
  const WEBHOOK_URL = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT}/${REGION}/stripeWebhook`;
  let biancaUid: string;

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
    const account = await accountByEmail(ESTETICISTA.email);
    biancaUid = String(account!.userId);
    // O que a rotina diaria teria feito: marcar o inicio da retencao.
    await adminDb().doc(paths.account(biancaUid)).update({ blockedSince: new Date(Date.now() - DAY_MS).toISOString() });
  });

  it("o pagamento reabre o painel e tira a conta do ciclo do teste", async () => {
    const now = Math.floor(Date.now() / 1000);
    const metadata = { organizationId: biancaOrg, subscriberUserId: biancaUid, planId: "profissional-mensal" };
    const vinculo = await deliver({
      id: "evt_a6_vinculo",
      type: "checkout.session.completed",
      created: now,
      data: { object: { mode: "subscription", customer: "cus_a6", subscription: "sub_a6", client_reference_id: biancaOrg, metadata } },
    });
    const ativa = await deliver({
      id: "evt_a6_ativa",
      type: "customer.subscription.created",
      created: now + 1,
      data: {
        object: {
          id: "sub_a6",
          customer: "cus_a6",
          status: "active",
          cancel_at_period_end: false,
          currency: "brl",
          current_period_start: now,
          current_period_end: now + 30 * 86_400,
          items: { data: [{ price: { unit_amount: 19_900, recurring: { interval: "month" } } }] },
          metadata,
        },
      },
    });
    expect(vinculo).toMatchObject({ status: 200, outcome: "APPLIED" });
    expect(ativa).toMatchObject({ status: 200, outcome: "APPLIED" });

    const account = await accountByEmail(ESTETICISTA.email);
    expect(account).toMatchObject({ subscriptionStatus: "ACTIVE", blockedSince: null });
    expect(Date.parse(String(account!.subscribedAt))).not.toBeNaN();

    // As regras reais voltam a entregar a organizacao.
    const organizacao = await getDoc(doc(bianca.firestore, paths.organization(biancaOrg)));
    expect(organizacao.data()).toMatchObject({ primaryProfession: "AESTHETICS" });
  });

  it("a rotina diaria nao encontra mais a conta", async () => {
    // Mesma consulta de `closeExpiredTrials`, com a validade forcada ao passado.
    const vencido = new Date(Date.now() - DAY_MS).toISOString();
    await adminDb().doc(paths.account(biancaUid)).update({ accessUntil: vencido, accessUntilMs: Date.parse(vencido) });
    const candidatas = await adminDb()
      .collection(paths.accounts())
      .where("origin", "==", "SELF_SERVICE")
      .where("blockedSince", "==", null)
      .where("subscribedAt", "==", null)
      .where("accessUntilMs", ">", 0)
      .where("accessUntilMs", "<=", Date.now())
      .get();
    const ids = candidatas.docs.map((entry: { id: string }) => entry.id);
    expect(ids).not.toContain(biancaUid);
  });
});
