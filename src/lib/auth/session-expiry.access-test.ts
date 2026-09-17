import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { paths } from "@/lib/firebase/paths";
import { adminDb, deleteAdminApps, initializeAdminSdk } from "@/lib/testing/admin-sdk";
import { PROJECT, tokenSession, type TokenSession } from "@/lib/testing/emulator-session";

/**
 * S-13: o que acontece com uma leitura ABERTA quando a validade vence.
 *
 * Esta suite existe para registrar o comportamento, e nao para aprova-lo. A
 * conta tem validade de poucos segundos; uma leitura e aberta antes do
 * vencimento e o documento muda depois dele.
 *
 * O que as regras garantem — e esta suite prova — e que uma leitura NOVA depois
 * do vencimento e negada. O que elas nao garantem, no emulador, e fechar uma
 * leitura que ja estava aberta. Por isso `WorkspaceProvider` passou a reavaliar
 * a validade no relogio e fechar os listeners quando ela vence.
 *
 * O teste do meio descreve o emulador. Se um dia ele falhar, o emulador passou a
 * fechar a leitura sozinho: vale reconferir a S-13 em producao, pelo roteiro de
 * `docs/seguranca/SESSAO-QUE-VENCE.md`.
 *
 * Rodar com: npm run test:access
 */

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9098";
const [FIRESTORE_HOST, FIRESTORE_PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8087").split(":");

const UID = "sessao-que-vence";
const ORG = "org-sessao-que-vence";
const CLIENT = "cliente-ficticio";
const VALIDADE_MS = 4_000;

let expiresAt: number;
let aberta: TokenSession;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clientRef = () => adminDb().doc(paths.document(ORG, "clients", CLIENT));

beforeAll(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = `${FIRESTORE_HOST}:${FIRESTORE_PORT}`;
  initializeAdminSdk(PROJECT);

  expiresAt = Date.now() + VALIDADE_MS;
  const stamp = new Date().toISOString();
  await adminDb().doc(paths.account(UID)).set({
    userId: UID,
    email: "sessao-que-vence@atendara.test",
    displayName: "Sessão Que Vence",
    platformRole: "PROFESSIONAL",
    organizationId: ORG,
    professionId: "PSYCHOLOGIST",
    modules: ["clientes"],
    status: "ACTIVE",
    subscriptionStatus: "ACTIVE",
    accessUntil: new Date(expiresAt).toISOString(),
    accessUntilMs: expiresAt,
    mustChangePassword: false,
    createdAt: stamp,
  });
  await adminDb().doc(paths.organization(ORG)).set({ id: ORG, ownerId: UID, primaryProfession: "PSYCHOLOGIST", professions: ["PSYCHOLOGIST"] });
  await adminDb().doc(paths.document(ORG, "members", UID)).set({ id: UID, userId: UID, organizationId: ORG, role: "PROFESSIONAL", status: "ACTIVE" });
  await clientRef().set({ id: CLIENT, organizationId: ORG, fullName: "Cliente Fictício", status: "ACTIVE" });

  aberta = tokenSession(UID, null);
}, 60_000);

afterAll(async () => {
  await aberta?.dispose();
  await deleteAdminApps();
});

describe("S-13 — validade que vence com a leitura aberta", () => {
  const recebidos: string[] = [];
  let fechar: () => void = () => {};

  it("antes do vencimento a leitura abre normalmente", async () => {
    await new Promise<void>((resolve, reject) => {
      fechar = onSnapshot(
        doc(aberta.firestore, paths.document(ORG, "clients", CLIENT)),
        (snapshot) => {
          recebidos.push(String(snapshot.data()?.fullName));
          resolve();
        },
        reject,
      );
    });
    expect(recebidos).toEqual(["Cliente Fictício"]);
  });

  it("no emulador, a leitura ja aberta continua recebendo depois do vencimento", async () => {
    await sleep(Math.max(0, expiresAt - Date.now()) + 1_500);
    await clientRef().update({ fullName: "Alterado depois do vencimento" });
    await sleep(1_500);

    // E isto que a correcao do cliente fecha: sem ela, a mudanca chega.
    expect(recebidos).toContain("Alterado depois do vencimento");
  });

  it("uma leitura NOVA depois do vencimento e negada pelas regras", async () => {
    const nova = tokenSession(UID, null);
    await expect(getDoc(doc(nova.firestore, paths.document(ORG, "clients", CLIENT)))).rejects.toMatchObject({
      code: "permission-denied",
    });
    await nova.dispose();
  });

  it("fechada a leitura, como o painel passou a fazer, nada mais chega", async () => {
    fechar();
    const antes = recebidos.length;
    await clientRef().update({ fullName: "Depois de fechar" });
    await sleep(1_500);
    expect(recebidos).toHaveLength(antes);
  });
});
