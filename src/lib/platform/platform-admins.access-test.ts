import { createRequire } from "node:module";

import { collection, getDocs } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { paths } from "@/lib/firebase/paths";
import { PROJECT, tokenSession, type TokenSession } from "@/lib/testing/emulator-session";

/**
 * Chave mestra e administradores da plataforma, de ponta a ponta: callables com
 * segundo fator e App Check, o Auth do emulador e as Security Rules decidindo
 * quem le as contas.
 *
 * Leituras depois de suspender e reativar saem de sessao NOVA: no emulador, uma
 * conexao ja aberta pode seguir com a avaliacao anterior.
 *
 * Rodar com: npm run test:access
 */

const require = createRequire(import.meta.url);
const admin = require("../../../functions/node_modules/firebase-admin/lib/index.js");

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9098";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8087";
const MASTER_UID = "chave-mestra-dos-testes";
const ADMIN_UID = "administrador-comum-dos-testes";

let master: TokenSession;
let plainAdmin: TokenSession;

function operatorAccount(uid: string, platformMaster: boolean) {
  return {
    userId: uid,
    email: `${uid}@nexo.test`,
    displayName: platformMaster ? "Chave Mestra de Teste" : "Administrador de Teste",
    platformRole: "PLATFORM_ADMIN",
    platformMaster,
    professionId: null,
    organizationId: null,
    modules: [],
    status: "ACTIVE",
    mustChangePassword: false,
    createdAt: new Date().toISOString(),
  };
}

async function accountOf(uid: string): Promise<Record<string, unknown>> {
  return (await admin.firestore().doc(paths.account(uid)).get()).data();
}

/** Lista contas por uma sessao nova do administrador comum e a descarta. */
async function listAccountsAsPlainAdmin(): Promise<unknown> {
  const session = tokenSession(ADMIN_UID, "totp");
  try {
    return await getDocs(collection(session.firestore, paths.accounts()));
  } finally {
    await session.dispose();
  }
}

beforeAll(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  admin.initializeApp({ projectId: PROJECT });

  await admin.firestore().doc(paths.account(MASTER_UID)).set(operatorAccount(MASTER_UID, true));
  // O administrador comum existe no Auth: suspender precisa desativar o login dele.
  await admin.auth().createUser({ uid: ADMIN_UID, email: `${ADMIN_UID}@nexo.test`, password: "SenhaDeTeste-Admin-7" });
  await admin.firestore().doc(paths.account(ADMIN_UID)).set(operatorAccount(ADMIN_UID, false));

  master = tokenSession(MASTER_UID, "totp");
  plainAdmin = tokenSession(ADMIN_UID, "totp");
}, 60_000);

afterAll(async () => {
  await Promise.all([master, plainAdmin].map((session) => session.dispose()));
  await Promise.all(admin.apps.map((instance: { delete(): Promise<void> }) => instance.delete()));
});

describe("Chave mestra e administradores da plataforma", () => {
  it("so a chave mestra cria administrador, que nasce sem chave mestra e com trilha", async () => {
    const payload = { displayName: "Terceira Programadora", email: "terceira-programadora@nexo.test" };
    await expect(plainAdmin.call("createPlatformAdmin", payload)).rejects.toMatchObject({ code: "permission-denied" });

    const created = await master.call<{ userId: string; temporaryPassword: string }>("createPlatformAdmin", payload);
    expect((await admin.auth().getUser(created.userId)).email).toBe(payload.email);
    expect(await accountOf(created.userId)).toMatchObject({
      platformRole: "PLATFORM_ADMIN",
      platformMaster: false,
      mustChangePassword: true,
      organizationId: null,
    });

    const trail = await admin.firestore().collection(paths.platformAuditLogs()).where("targetUserId", "==", created.userId).get();
    expect(trail.docs.map((entry: { data(): Record<string, unknown> }) => entry.data())).toEqual([
      expect.objectContaining({ action: "PLATFORM_ADMIN_CREATED", actorId: MASTER_UID }),
    ]);
  });

  it("suspender fecha as regras, as callables e o login; reativar devolve", async () => {
    await expect(listAccountsAsPlainAdmin()).resolves.toBeDefined();

    await master.call("setPlatformAdminStatus", { userId: ADMIN_UID, status: "SUSPENDED" });
    expect((await admin.auth().getUser(ADMIN_UID)).disabled).toBe(true);
    expect(await accountOf(ADMIN_UID)).toMatchObject({ status: "SUSPENDED" });
    await expect(listAccountsAsPlainAdmin()).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      plainAdmin.call("createPlatformAdmin", { displayName: "Tentativa Suspensa", email: "tentativa-suspensa@nexo.test" }),
    ).rejects.toMatchObject({ code: "permission-denied" });

    await master.call("setPlatformAdminStatus", { userId: ADMIN_UID, status: "ACTIVE" });
    expect((await admin.auth().getUser(ADMIN_UID)).disabled).toBe(false);
    await expect(listAccountsAsPlainAdmin()).resolves.toBeDefined();
  });

  it("a chave mestra nao se suspende nem e suspensa por outro administrador", async () => {
    await expect(master.call("setPlatformAdminStatus", { userId: MASTER_UID, status: "SUSPENDED" })).rejects.toMatchObject({
      code: "failed-precondition",
    });
    await expect(plainAdmin.call("setPlatformAdminStatus", { userId: MASTER_UID, status: "SUSPENDED" })).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(await accountOf(MASTER_UID)).toMatchObject({ status: "ACTIVE" });
  });
});
