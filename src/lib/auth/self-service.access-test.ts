import { doc, getDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TRIAL_DAYS } from "@/config/platform";
import { LEGAL_VERSION } from "@/config/legal";
import { paths } from "@/lib/firebase/paths";
import { adminDb, deleteAdminApps, initializeAdminSdk } from "@/lib/testing/admin-sdk";
import {
  CallableError,
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
