import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { paths } from "@/lib/firebase/paths";
import type { PublicPaymentView } from "@/lib/finance/payment-proof";
import { AdminTimestamp, adminBucket, adminDb, deleteAdminApps, initializeAdminSdk } from "@/lib/testing/admin-sdk";
import { CallableError, PROJECT, callFunction, tokenSession, type TokenSession } from "@/lib/testing/emulator-session";

/**
 * Link de pagamento e comprovante (cobrador, C2) de ponta a ponta: functions
 * reais, Firestore e Storage emulados, regras reais.
 *
 * A pessoa que paga nao tem conta: consulta e envio vao SEM token de usuario,
 * so com App Check. O que se prova e que o link abre so a cobranca dele, que o
 * arquivo entra pelo backend com o tipo real, e que ninguem burla o fluxo.
 */

const ORG = "org-pagamento";
const TX = "m1-202609";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]).toString("base64");
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

let owner: TokenSession;
let viewer: TokenSession;

async function member(uid: string, role: string, modules: string[]): Promise<TokenSession> {
  await adminDb().doc(paths.account(uid)).set({
    userId: uid, email: `${uid}@atendara.test`, displayName: uid, platformRole: "PROFESSIONAL",
    organizationId: ORG, professionId: "PSYCHOLOGIST", modules, status: "ACTIVE", mustChangePassword: false,
    subscriptionStatus: "ACTIVE", accessUntil: inDays(30), accessUntilMs: Date.parse(inDays(30)), createdAt: new Date().toISOString(),
  });
  await adminDb().doc(paths.document(ORG, "members", uid)).set({ id: uid, userId: uid, organizationId: ORG, role, status: "ACTIVE" });
  return tokenSession(uid, null);
}

beforeAll(async () => {
  initializeAdminSdk(PROJECT);
  const at = AdminTimestamp.fromDate(new Date("2026-09-01T10:00:00.000Z"));
  await adminDb().doc(paths.organization(ORG)).set({ id: ORG, name: "Consultório Pagamento", primaryProfession: "PSYCHOLOGIST", ownerId: "dono-pg" });
  await adminDb().doc(paths.document(ORG, "transactions", TX)).set({
    id: TX, organizationId: ORG, type: "INCOME", clientId: "c1", clientName: "Beatriz Pagadora Ficticia", professionalId: null,
    appointmentId: null, appointmentPart: null, description: "Mensalidade — setembro de 2026", amountInCents: 45000,
    status: "PENDING", method: "PIX", dueDate: AdminTimestamp.fromDate(new Date("2026-09-28T15:00:00.000Z")), paidAt: null,
    gateway: null, recurringChargeId: "m1", period: "2026-09", createdAt: at, updatedAt: at, createdBy: null, updatedBy: null,
  });
  owner = await member("dono-pg", "OWNER", ["financeiro", "clientes"]);
  viewer = await member("leitor-pg", "VIEWER", ["financeiro"]);
});

afterAll(async () => {
  await owner?.dispose();
  await viewer?.dispose();
  await deleteAdminApps();
});

describe("Cobrador C2 — link de pagamento e comprovante", () => {
  let token = "";

  it("só quem cria lançamento gera o link", async () => {
    await expect(viewer.call("createPaymentLink", { transactionId: TX })).rejects.toMatchObject({ code: "permission-denied" });
    ({ token } = await owner.call<{ token: string }>("createPaymentLink", { transactionId: TX }));
    expect(token.length).toBeGreaterThanOrEqual(43);
    const stored = (await adminDb().doc(paths.document(ORG, "paymentLinks", TX)).get()).data();
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sem login, o link mostra só a cobrança — sem o nome de quem paga", async () => {
    const view = await callFunction<PublicPaymentView>("inspectPaymentLink", { token });
    expect(view).toMatchObject({ organizationName: "Consultório Pagamento", amountInCents: 45000, situation: "OPEN", proof: "NONE" });
    expect(JSON.stringify(view)).not.toContain("Beatriz");
    await expect(callFunction("inspectPaymentLink", { token: "x".repeat(43) })).rejects.toMatchObject({ code: "not-found" });
    await expect(callFunction("inspectPaymentLink", { token }, { appCheck: false })).rejects.toBeInstanceOf(CallableError);
  });

  it("recusa o que não é imagem nem PDF, antes de gravar", async () => {
    const html = Buffer.from("<html>comprovante.pdf</html>").toString("base64");
    await expect(callFunction("submitPaymentProof", { token, file: html })).rejects.toMatchObject({ code: "invalid-argument" });
    const [files] = await adminBucket().getFiles({ prefix: `paymentProofs/${ORG}/` });
    expect(files).toHaveLength(0);
  });

  it("sem login, o comprovante entra pelo backend: arquivo, registro e alerta", async () => {
    await expect(callFunction("submitPaymentProof", { token, file: PNG })).resolves.toMatchObject({ received: true });
    const proofs = await adminDb().collection(paths.collection(ORG, "paymentProofs")).get();
    expect(proofs.size).toBe(1);
    const proof = proofs.docs[0].data();
    expect(proof).toMatchObject({ status: "SUBMITTED", transactionId: TX, contentType: "image/png" });
    const [exists] = await adminBucket().file(proof.storagePath).exists();
    expect(exists).toBe(true);
    const alerts = await adminDb().collection(paths.collection(ORG, "notifications")).where("type", "==", "PAYMENT_PROOF_RECEIVED").get();
    expect(alerts.size).toBe(1);

    const view = await callFunction<PublicPaymentView>("inspectPaymentLink", { token });
    expect(view.proof).toBe("SUBMITTED");
    await expect(callFunction("submitPaymentProof", { token, file: PNG })).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("gerar um novo link invalida o anterior", async () => {
    const { token: renewed } = await owner.call<{ token: string }>("createPaymentLink", { transactionId: TX });
    await expect(callFunction("inspectPaymentLink", { token })).rejects.toMatchObject({ code: "not-found" });
    await expect(callFunction<PublicPaymentView>("inspectPaymentLink", { token: renewed })).resolves.toMatchObject({ situation: "OPEN" });
  });
});
