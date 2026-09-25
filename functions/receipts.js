import { createHash, randomUUID } from "node:crypto";

import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import {
  amountInWords,
  cancelReasonError,
  issueReceiptError,
  maskDocument,
  receiptContent,
  validateIssuer,
  validateReceiptRequest,
} from "./generated/finance-receipts.js";
import { paths } from "./generated/paths.js";
import { getProfession, isProfessionId } from "./generated/professions.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { ACCOUNT_CALL_OPTIONS, parse } from "./platform-auth.js";
import { consumeRateLimit } from "./rate-limit.js";
import { runAs } from "./service-accounts.js";
import { tenantActor } from "./tenant-auth.js";

/**
 * Recibos (ADR 0004, 14.9 — cobrador C3).
 *
 * So o backend emite: a numeracao e sequencial por organizacao e reservada na
 * mesma transacao que grava o recibo, entao dois cliques simultaneos nao
 * repetem numero. O recibo guarda a copia do que foi impresso; cancelar nao
 * apaga nem libera o numero.
 */

const db = () => getFirestore();
const OPTIONS = { ...ACCOUNT_CALL_OPTIONS, ...runAs("automacao") };

async function financeActor(request, permission) {
  const actor = await tenantActor(request, permission);
  if (!actor.account.modules?.includes("financeiro")) {
    throw new HttpsError("permission-denied", "Seu acesso não inclui o financeiro.");
  }
  return actor;
}

const nullableText = (max) => z.string().max(max).nullable();

const issueSchema = z
  .object({
    transactionId: z.string().min(1).max(160),
    payerName: z.string().min(1).max(120),
    payerDocument: nullableText(20),
    beneficiaryName: nullableText(120),
    beneficiaryDocument: nullableText(20),
    description: z.string().min(1).max(200),
  })
  .strict();

function audit(organizationId, actor, action, receiptId, summary, metadata) {
  const now = new Date().toISOString();
  const id = randomUUID();
  return {
    ref: db().doc(paths.document(organizationId, "auditLogs", id)),
    data: toStored("auditLogs", {
      id,
      organizationId,
      actorType: "USER",
      actorId: actor.userId,
      actorName: actor.account.displayName ?? "Usuário",
      action,
      resource: { type: "receipt", id: receiptId },
      summary,
      metadata,
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }),
  };
}

export const issueReceipt = onCall(OPTIONS, async (request) => {
  const actor = await financeActor(request, "receipt:create");
  await consumeRateLimit(request.auth.uid, "receiptWrite");
  const input = parse(issueSchema, request.data);
  const request_ = validateReceiptRequest(input);
  if (!request_.ok) throw new HttpsError("invalid-argument", request_.error);
  const organizationId = actor.organizationId;
  const tenant = (name, id) => db().doc(paths.document(organizationId, name, id));

  return db().runTransaction(async (transaction) => {
    const [txSnapshot, settingsSnapshot, counterSnapshot, issued] = await Promise.all([
      transaction.get(tenant("transactions", input.transactionId)),
      transaction.get(tenant("receiptSettings", "organization")),
      transaction.get(tenant("receiptCounters", "organization")),
      transaction.get(
        db()
          .collection(paths.collection(organizationId, "receipts"))
          .where("transactionId", "==", input.transactionId)
          .where("status", "==", "ISSUED"),
      ),
    ]);
    const paid = txSnapshot.exists ? fromStored("transactions", txSnapshot.id, txSnapshot.data()) : null;
    const refused = issueReceiptError(paid, issued.size);
    if (refused) throw new HttpsError("failed-precondition", refused);
    const issuer = settingsSnapshot.exists ? validateIssuer(settingsSnapshot.data()) : null;
    if (!issuer?.ok) throw new HttpsError("failed-precondition", "Preencha quem emite os recibos em Configurações → Recibos.");

    // O registro no conselho vem de quem atendeu, quando o lancamento diz.
    const professional = paid.professionalId
      ? (await transaction.get(tenant("professionals", paid.professionalId))).data() ?? null
      : null;
    const professionId = isProfessionId(professional?.profession) ? professional.profession : actor.organization.primaryProfession;
    const profession = getProfession(professionId);
    const registry = profession.council && professional?.licenseNumber ? `${profession.council.acronym} ${professional.licenseNumber}` : null;

    const number = (counterSnapshot.data()?.lastNumber ?? 0) + 1;
    const now = new Date().toISOString();
    const receiptId = randomUUID();
    const printed = {
      number,
      ...issuer.value,
      issuerRegistry: registry,
      ...request_.value,
      amountInCents: paid.amountInCents,
      amountInWords: amountInWords(paid.amountInCents),
      paidAt: paid.paidAt ?? now,
      method: paid.method ?? null,
      issuedAt: now,
    };
    const receipt = {
      id: receiptId,
      organizationId,
      transactionId: paid.id,
      clientId: paid.clientId ?? null,
      professionalId: paid.professionalId ?? null,
      ...printed,
      officialTaxReceipt: profession.officialTaxReceipt ?? null,
      status: "ISSUED",
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      contentHash: createHash("sha256").update(receiptContent(printed)).digest("hex"),
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    };
    transaction.set(tenant("receiptCounters", "organization"), toStored("receiptCounters", {
      id: "organization", organizationId, lastNumber: number, createdAt: now, updatedAt: now, createdBy: actor.userId, updatedBy: actor.userId,
    }));
    transaction.create(tenant("receipts", receiptId), toStored("receipts", receipt));
    // CPF so mascarado fora do recibo.
    const entry = audit(organizationId, actor, "CREATE", receiptId, `Recibo nº ${number} emitido.`, {
      number, transactionId: paid.id, amountInCents: paid.amountInCents, payerDocument: maskDocument(receipt.payerDocument),
    });
    transaction.create(entry.ref, entry.data);
    return { receiptId, number };
  });
});

export const cancelReceipt = onCall(OPTIONS, async (request) => {
  const actor = await financeActor(request, "receipt:cancel");
  await consumeRateLimit(request.auth.uid, "receiptWrite");
  const input = parse(z.object({ receiptId: z.string().min(1).max(160), reason: z.string().min(1).max(200) }).strict(), request.data);
  const reasonError = cancelReasonError(input.reason);
  if (reasonError) throw new HttpsError("invalid-argument", reasonError);
  const organizationId = actor.organizationId;
  const ref = db().doc(paths.document(organizationId, "receipts", input.receiptId));

  return db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "Recibo não encontrado.");
    const receipt = snapshot.data();
    if (receipt.status !== "ISSUED") throw new HttpsError("failed-precondition", "Este recibo já foi cancelado.");
    const now = new Date().toISOString();
    transaction.update(ref, toStored("receipts", {
      status: "CANCELLED", cancelledAt: now, cancelledBy: actor.userId, cancellationReason: input.reason.trim(), updatedAt: now, updatedBy: actor.userId,
    }));
    // O motivo fica no recibo; na trilha, so o numero: e texto livre.
    const entry = audit(organizationId, actor, "UPDATE", input.receiptId, `Recibo nº ${receipt.number} cancelado.`, { number: receipt.number });
    transaction.create(entry.ref, entry.data);
    return { cancelled: true };
  });
});
