import { createHash, randomBytes, randomUUID } from "node:crypto";

import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import {
  PAYMENT_PROOF_LIMITS,
  detectProofType,
  paymentLinkError,
  paymentProofStoragePath,
  publicPaymentView,
  submitProofError,
} from "./generated/finance-payment-proof.js";
import { paths } from "./generated/paths.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { ACCOUNT_CALL_OPTIONS, parse } from "./platform-auth.js";
import { consumeRateLimit, networkSubject } from "./rate-limit.js";
import { runAs } from "./service-accounts.js";
import { tenantActor } from "./tenant-auth.js";

/**
 * Link de pagamento e comprovante (cobrador, C2).
 *
 * O cliente do profissional nao tem conta. Quem prova que ele pode ver a
 * cobranca e mandar o comprovante e o token do link: 32 bytes aleatorios,
 * buscado pelo hash. O arquivo entra pelo backend, que confere o link, o tipo
 * real pelos primeiros bytes e o tamanho — nenhuma escrita anonima no Storage.
 *
 * Nenhum dinheiro passa por aqui, e nenhuma mensagem sai: o profissional copia
 * o link e manda por onde quiser.
 */

const db = () => getFirestore();
const OPTIONS = { ...ACCOUNT_CALL_OPTIONS, ...runAs("automacao") };

const hashOf = (token) => createHash("sha256").update(token).digest("hex");
const tokenSchema = z.object({ token: z.string().min(32).max(128) }).strict();

async function linkByToken(token) {
  const found = await db().collectionGroup("paymentLinks").where("tokenHash", "==", hashOf(token)).limit(2).get();
  // Dois links com o mesmo hash seriam erro: ninguem ve nada, em vez de ver o errado.
  if (found.size !== 1) throw new HttpsError("not-found", "Link de pagamento inválido ou substituído por um novo.");
  const document = found.docs[0];
  const organizationId = document.ref.parent.parent?.id;
  const link = fromStored("paymentLinks", document.id, document.data());
  if (!organizationId || link.organizationId !== organizationId) {
    throw new HttpsError("not-found", "Link de pagamento inválido ou substituído por um novo.");
  }
  return link;
}

async function chargeContext(link) {
  const tenant = (name) => db().collection(paths.collection(link.organizationId, name));
  const [organization, transactionSnapshot, proofSnapshot] = await Promise.all([
    db().doc(paths.organization(link.organizationId)).get(),
    db().doc(paths.document(link.organizationId, "transactions", link.transactionId)).get(),
    tenant("paymentProofs").where("transactionId", "==", link.transactionId).get(),
  ]);
  if (!organization.exists || !transactionSnapshot.exists) {
    throw new HttpsError("not-found", "Esta cobrança não existe mais.");
  }
  return {
    organizationName: organization.data().name ?? "Organização",
    transaction: fromStored("transactions", transactionSnapshot.id, transactionSnapshot.data()),
    proofs: proofSnapshot.docs.map((document) => fromStored("paymentProofs", document.id, document.data())),
  };
}

/** Gera (ou troca) o link de um mes de mensalidade. O token antigo deixa de valer. */
export const createPaymentLink = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "transaction:create");
  if (!actor.account.modules?.includes("financeiro")) {
    throw new HttpsError("permission-denied", "Seu acesso não inclui o financeiro.");
  }
  await consumeRateLimit(request.auth.uid, "paymentLinkWrite");
  const { transactionId } = parse(z.object({ transactionId: z.string().min(1).max(160) }).strict(), request.data);
  const organizationId = actor.organizationId;

  const snapshot = await db().doc(paths.document(organizationId, "transactions", transactionId)).get();
  const transaction = snapshot.exists ? fromStored("transactions", snapshot.id, snapshot.data()) : null;
  const refused = paymentLinkError(transaction);
  if (refused) throw new HttpsError("failed-precondition", refused);

  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const auditId = randomUUID();
  const batch = db().batch();
  batch.set(
    db().doc(paths.document(organizationId, "paymentLinks", transactionId)),
    toStored("paymentLinks", {
      id: transactionId,
      organizationId,
      transactionId,
      token,
      tokenHash: hashOf(token),
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }),
  );
  batch.create(
    db().doc(paths.document(organizationId, "auditLogs", auditId)),
    toStored("auditLogs", {
      id: auditId,
      organizationId,
      actorType: "USER",
      actorId: actor.userId,
      actorName: actor.account.displayName ?? "Usuário",
      action: "CREATE",
      resource: { type: "transaction", id: transactionId },
      summary: "Link de pagamento gerado. Um link anterior deste mês deixa de valer.",
      metadata: { transactionId },
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }),
  );
  await batch.commit();
  return { token };
});

/** O que a pagina publica mostra. Sem login; limitado por rede. */
export const inspectPaymentLink = onCall(OPTIONS, async (request) => {
  await consumeRateLimit(networkSubject(request), "paymentLinkByNetwork");
  const { token } = parse(tokenSchema, request.data);
  const link = await linkByToken(token);
  const context = await chargeContext(link);
  return publicPaymentView(context.organizationName, context.transaction, context.proofs);
});

const submitSchema = z
  .object({
    token: z.string().min(32).max(128),
    // Base64 de ate 5 MB: 4/3 do tamanho, com folga do preenchimento.
    file: z.string().min(8).max(Math.ceil((PAYMENT_PROOF_LIMITS.maxBytes * 4) / 3) + 8),
  })
  .strict();

/** Recebe o comprovante. O tipo que vale e o dos bytes, nao o do nome. */
// O arquivo de ate 5 MB chega em base64 e passa pela memoria duas vezes.
const PROOF_OPTIONS = { ...OPTIONS, memory: "512MiB" };

export const submitPaymentProof = onCall(PROOF_OPTIONS, async (request) => {
  await consumeRateLimit(networkSubject(request), "paymentProofByNetwork");
  const input = parse(submitSchema, request.data);
  const bytes = Buffer.from(input.file, "base64");
  if (bytes.length === 0 || bytes.length > PAYMENT_PROOF_LIMITS.maxBytes) {
    throw new HttpsError("invalid-argument", "Envie um arquivo de até 5 MB.");
  }
  const contentType = detectProofType(new Uint8Array(bytes.subarray(0, 16)));
  if (!contentType) throw new HttpsError("invalid-argument", "Envie o comprovante como imagem (PNG, JPEG ou WEBP) ou PDF.");

  const link = await linkByToken(input.token);
  const context = await chargeContext(link);
  const refused = submitProofError(context.transaction, context.proofs);
  if (refused) throw new HttpsError("failed-precondition", refused);

  const organizationId = link.organizationId;
  const proofId = randomUUID();
  const storagePath = paymentProofStoragePath(organizationId, link.transactionId, proofId);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = getStorage().bucket().file(storagePath);
  // Arquivo primeiro: um registro apontando para arquivo inexistente seria
  // pior do que um arquivo sem registro, que a limpeza da organizacao alcanca.
  await file.save(bytes, { contentType, resumable: false, metadata: { cacheControl: "private, max-age=0" } });

  const now = new Date().toISOString();
  const transaction = context.transaction;
  const alertId = `${proofId}-alerta`;
  const auditId = `${proofId}-envio`;
  const batch = db().batch();
  batch.create(
    db().doc(paths.document(organizationId, "paymentProofs", proofId)),
    toStored("paymentProofs", {
      id: proofId,
      organizationId,
      transactionId: transaction.id,
      recurringChargeId: transaction.recurringChargeId ?? null,
      clientId: transaction.clientId ?? null,
      status: "SUBMITTED",
      storagePath,
      contentType,
      sizeBytes: bytes.length,
      sha256,
      submittedAt: now,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
    }),
  );
  batch.create(
    db().doc(paths.document(organizationId, "notifications", alertId)),
    toStored("notifications", {
      id: alertId,
      organizationId,
      type: "PAYMENT_PROOF_RECEIVED",
      status: "UNREAD",
      priority: "NORMAL",
      title: "Comprovante recebido",
      // Sem nome: o alerta aparece para toda a equipe, e a conferencia mostra o resto.
      body: `${transaction.description}. Confira em Financeiro → Mensalidades.`,
      target: { type: "transaction", id: transaction.id },
      professionalId: transaction.professionalId ?? null,
      channels: ["DASHBOARD"],
      aiDecisionId: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    }),
  );
  batch.create(
    db().doc(paths.document(organizationId, "auditLogs", auditId)),
    toStored("auditLogs", {
      id: auditId,
      organizationId,
      actorType: "SYSTEM",
      actorId: null,
      actorName: "Link de pagamento",
      action: "CREATE",
      resource: { type: "paymentProof", id: proofId },
      summary: "Comprovante recebido pelo link de pagamento.",
      metadata: { transactionId: transaction.id, contentType, sizeBytes: bytes.length },
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
    }),
  );
  try {
    await batch.commit();
  } catch (error) {
    await file.delete({ ignoreNotFound: true }).catch(() => undefined);
    logger.error("payment_proof.record_failed", { organizationId, code: error?.code ?? null });
    throw new HttpsError("internal", "Não foi possível registrar o comprovante. Tente de novo.");
  }
  return { received: true };
});
