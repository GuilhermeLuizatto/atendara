import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { paths } from "@/lib/firebase/paths";
import { receiptContent } from "@/lib/finance/receipts";
import { AdminTimestamp, adminDb, deleteAdminApps, initializeAdminSdk } from "@/lib/testing/admin-sdk";
import { PROJECT, tokenSession, type TokenSession } from "@/lib/testing/emulator-session";

/**
 * Recibos (ADR 0004, 14.9 — C3) de ponta a ponta: callables reais, numeracao
 * reservada em transacao, regras reais.
 */

const ORG = "org-recibos";
// CPFs e CNPJ gerados so para teste: digitos validos, sem dono.
const ISSUER_CPF = "52998224725";
const PAYER_CPF = "11144477735";
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

let owner: TokenSession;
let assistant: TokenSession;

async function member(uid: string, role: string): Promise<TokenSession> {
  await adminDb().doc(paths.account(uid)).set({
    userId: uid, email: `${uid}@atendara.test`, displayName: uid, platformRole: "PROFESSIONAL",
    organizationId: ORG, professionId: "PSYCHOLOGIST", modules: ["financeiro", "clientes"], status: "ACTIVE",
    mustChangePassword: false, subscriptionStatus: "ACTIVE", accessUntil: inDays(30), accessUntilMs: Date.parse(inDays(30)), createdAt: new Date().toISOString(),
  });
  await adminDb().doc(paths.document(ORG, "members", uid)).set({ id: uid, userId: uid, organizationId: ORG, role, status: "ACTIVE" });
  return tokenSession(uid, null);
}

async function transaction(id: string, status: string, amountInCents = 45000) {
  const at = AdminTimestamp.fromDate(new Date("2026-09-20T12:00:00.000Z"));
  await adminDb().doc(paths.document(ORG, "transactions", id)).set({
    id, organizationId: ORG, type: "INCOME", clientId: "cliente-r", clientName: "Diego Pagador Ficticio", professionalId: "prof-r",
    appointmentId: null, appointmentPart: null, description: "Sessão de setembro", amountInCents, status, method: "PIX",
    dueDate: at, paidAt: status === "PAID" ? at : null, gateway: null, createdAt: at, updatedAt: at, createdBy: null, updatedBy: null,
  });
}

const issue = (session: TokenSession, transactionId: string) =>
  session.call<{ receiptId: string; number: number }>("issueReceipt", {
    transactionId, payerName: "Diego Pagador Ficticio", payerDocument: PAYER_CPF, beneficiaryName: null, beneficiaryDocument: null, description: "Sessão de setembro",
  });

beforeAll(async () => {
  initializeAdminSdk(PROJECT);
  await adminDb().doc(paths.organization(ORG)).set({ id: ORG, name: "Consultório Recibos", primaryProfession: "PSYCHOLOGIST", ownerId: "dono-r" });
  await adminDb().doc(paths.document(ORG, "professionals", "prof-r")).set({ id: "prof-r", organizationId: ORG, profession: "PSYCHOLOGIST", licenseNumber: "06/12345", displayName: "Profissional R" });
  for (const id of ["pago-1", "pago-2", "pago-3"]) await transaction(id, "PAID");
  await transaction("aberto", "PENDING");
  owner = await member("dono-r", "OWNER");
  assistant = await member("secretaria-r", "ASSISTANT");
});

afterAll(async () => {
  await owner?.dispose();
  await assistant?.dispose();
  await deleteAdminApps();
});

describe("Cobrador C3 — recibos", () => {
  it("sem emissor configurado, não emite", async () => {
    await expect(issue(owner, "pago-1")).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("emite o nº 1 com cópia do impresso, extenso, registro e código que confere", async () => {
    await adminDb().doc(paths.document(ORG, "receiptSettings", "organization")).set({
      id: "organization", organizationId: ORG, issuerName: "Ana Emissora", issuerDocument: ISSUER_CPF, issuerAddress: "Rua Um, 10", issuerCity: "Santos",
    });
    await expect(issue(assistant, "pago-1")).rejects.toMatchObject({ code: "permission-denied" });
    await expect(issue(owner, "aberto")).rejects.toMatchObject({ code: "failed-precondition" });

    const { receiptId, number } = await issue(owner, "pago-1");
    expect(number).toBe(1);
    const stored = (await adminDb().doc(paths.document(ORG, "receipts", receiptId)).get()).data();
    expect(stored).toMatchObject({
      number: 1, status: "ISSUED", amountInCents: 45000, amountInWords: "quatrocentos e cinquenta reais",
      issuerRegistry: "CRP 06/12345", officialTaxReceipt: "RECEITA_SAUDE", payerDocument: PAYER_CPF,
    });
    const printed = { ...stored, paidAt: stored.paidAt.toDate().toISOString(), issuedAt: stored.issuedAt.toDate().toISOString() };
    expect(stored.contentHash).toBe(createHash("sha256").update(receiptContent(printed)).digest("hex"));

    const trail = await adminDb().collection(paths.collection(ORG, "auditLogs")).where("resource.id", "==", receiptId).get();
    expect(JSON.stringify(trail.docs.map((document: { data(): unknown }) => document.data()))).not.toContain(PAYER_CPF);
    await expect(issue(owner, "pago-1")).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("duas emissões ao mesmo tempo nunca repetem número", async () => {
    const [a, b] = await Promise.all([issue(owner, "pago-2"), issue(owner, "pago-3")]);
    expect(new Set([a.number, b.number])).toEqual(new Set([2, 3]));
  });

  it("cancelar guarda o motivo e não libera o número; o próximo segue a sequência", async () => {
    const first = await adminDb().collection(paths.collection(ORG, "receipts")).where("number", "==", 1).get();
    const receiptId = first.docs[0].id;
    await expect(assistant.call("cancelReceipt", { receiptId, reason: "Valor errado" })).rejects.toMatchObject({ code: "permission-denied" });
    await owner.call("cancelReceipt", { receiptId, reason: "Valor digitado errado" });
    const cancelled = (await adminDb().doc(paths.document(ORG, "receipts", receiptId)).get()).data();
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancellationReason: "Valor digitado errado", number: 1 });
    await expect(owner.call("cancelReceipt", { receiptId, reason: "de novo" })).rejects.toMatchObject({ code: "failed-precondition" });

    const reissued = await issue(owner, "pago-1");
    expect(reissued.number).toBe(4);
  });
});
