import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LEGAL_VERSION } from "@/config/legal";
import { UNCONFIRMED_SIGNUP_RETENTION_DAYS } from "@/config/platform";
import { paths } from "@/lib/firebase/paths";
import { adminAuth, adminDb, deleteAdminApps, initializeAdminSdk } from "@/lib/testing/admin-sdk";
import { callFunction } from "@/lib/testing/emulator-session";

/**
 * A.8 de ponta a ponta: a limpeza do cadastro nao confirmado contra o
 * Authentication e o Firestore emulados, com o cadastro criado pela callable
 * real e o apagamento real (`eraseOrganization`).
 *
 * O que os testes de unidade nao alcancam: o formato de `creationTime` e de
 * `emailVerified` que o Authentication devolve, e que o apagamento compartilhado
 * leva tudo o que o `registerSelfService` gravou — inclusive o login.
 *
 * A rotina e importada direto do backend e chamada com o relogio oito dias a
 * frente, porque o emulador nao deixa escolher a data de criacao de um login.
 *
 * Rodar com: npm run test:access
 */

const DAY_MS = 86_400_000;

const PARADA = {
  displayName: "Marina Teles",
  email: "marina-nao-confirmou@atendara.test",
  password: "senha-de-teste-marina",
  professionId: "PSYCHOLOGIST" as const,
  councilRegistration: "CRP 06/654321",
  businessName: "Consultório Travessia",
  acceptedLegalVersion: LEGAL_VERSION,
};

let paradaUid: string;
let paradaOrg: string;
let googleUid: string;
let confirmadaUid: string;

type Cleanup = (nowMs?: number) => Promise<{ orphans: number; erased: number }>;

/** Roda como a rotina diaria rodaria em dias seguidos, ate nao sobrar nada. */
async function runUntilDone(eraseUnconfirmedSignups: Cleanup, nowMs: number): Promise<void> {
  for (let rodada = 0; rodada < 20; rodada += 1) {
    const result = await eraseUnconfirmedSignups(nowMs);
    if (result.orphans === 0 && result.erased === 0) return;
  }
  throw new Error("a limpeza nao terminou em 20 rodadas");
}

async function loginExists(uid: string): Promise<boolean> {
  try {
    await adminAuth().getUser(uid);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  initializeAdminSdk("demo-atendara");
  const counters = await adminDb().collection("platformRateLimits").get();
  await Promise.all(counters.docs.map((counter: { ref: { delete(): Promise<unknown> } }) => counter.ref.delete()));

  const cadastro = await callFunction("registerSelfService", PARADA);
  expect(cadastro).toMatchObject({ ok: true });
  paradaUid = (await adminAuth().getUserByEmail(PARADA.email)).uid;
  paradaOrg = (await adminDb().doc(paths.account(paradaUid)).get()).data().organizationId;

  // Entrou pelo Google e parou antes da segunda tela: so o login existe.
  googleUid = (await adminAuth().createUser({ email: "google-parou@atendara.test", emailVerified: true })).uid;

  // Confirmou o e-mail e ainda nao comecou o teste: nao e desistencia.
  const confirmada = await callFunction("registerSelfService", {
    ...PARADA,
    displayName: "Rita Confirmada",
    email: "rita-confirmou@atendara.test",
    businessName: "Espaço Rita",
  });
  expect(confirmada).toMatchObject({ ok: true });
  confirmadaUid = (await adminAuth().getUserByEmail("rita-confirmou@atendara.test")).uid;
  await adminAuth().updateUser(confirmadaUid, { emailVerified: true });
}, 60_000);

afterAll(async () => {
  await deleteAdminApps();
});

describe("cadastro nao confirmado em sete dias (A.8)", () => {
  it("antes do prazo, nada sai", async () => {
    const { eraseUnconfirmedSignups } = await import("../../../functions/signup-cleanup.js");
    await runUntilDone(eraseUnconfirmedSignups, Date.now() + (UNCONFIRMED_SIGNUP_RETENTION_DAYS - 1) * DAY_MS);

    expect(await loginExists(paradaUid)).toBe(true);
    expect(await loginExists(googleUid)).toBe(true);
    expect((await adminDb().doc(paths.account(paradaUid)).get()).exists).toBe(true);
  });

  it("depois do prazo, o cadastro por senha sai inteiro e o login do Google some", async () => {
    const { eraseUnconfirmedSignups } = await import("../../../functions/signup-cleanup.js");
    await runUntilDone(eraseUnconfirmedSignups, Date.now() + (UNCONFIRMED_SIGNUP_RETENTION_DAYS + 1) * DAY_MS);

    expect(await loginExists(paradaUid)).toBe(false);
    expect((await adminDb().doc(paths.account(paradaUid)).get()).exists).toBe(false);
    expect((await adminDb().doc(paths.document(paradaOrg, "members", paradaUid)).get()).exists).toBe(false);
    expect((await adminDb().doc(paths.document(paradaOrg, "professionals", paradaUid)).get()).exists).toBe(false);

    // Sobra a lapide da organizacao, sem nome nem dono, como em toda exclusao.
    const lapide = (await adminDb().doc(paths.organization(paradaOrg)).get()).data();
    expect(lapide.deletion.status).toBe("DONE");
    expect(lapide).not.toHaveProperty("name");
    expect(lapide).not.toHaveProperty("ownerId");

    expect(await loginExists(googleUid)).toBe(false);
  });

  it("nenhum nome ou e-mail do cadastro apagado sobra no banco", async () => {
    const trilha = await adminDb().collection(paths.platformAuditLogs()).where("organizationId", "==", paradaOrg).get();
    const acoes = trilha.docs.map((entry: { data(): { action: string } }) => entry.data().action).sort();
    expect(acoes).toContain("UNCONFIRMED_SIGNUP_ERASED");
    const texto = JSON.stringify(trilha.docs.map((entry: { data(): unknown }) => entry.data()));
    for (const original of [PARADA.displayName, PARADA.email, PARADA.businessName, PARADA.councilRegistration]) {
      expect(texto).not.toContain(original);
    }

    const removido = await adminDb().collection(paths.platformAuditLogs()).where("targetUserId", "==", googleUid).get();
    expect(removido.docs.map((entry: { data(): { action: string } }) => entry.data().action)).toEqual(["ORPHAN_LOGIN_REMOVED"]);
  });

  it("quem confirmou o e-mail fica, mesmo sem ter comecado o teste", async () => {
    expect(await loginExists(confirmadaUid)).toBe(true);
    expect((await adminDb().doc(paths.account(confirmadaUid)).get()).exists).toBe(true);
  });
});
