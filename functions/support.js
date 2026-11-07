import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { ACCOUNT_CALL_OPTIONS, accountOf, adminOf, parse } from "./platform-auth.js";
import { paths } from "./generated/paths.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, SUPPORT_REPORTED_SEVERITIES, SUPPORT_TICKET_STATUSES } from "./generated/types-product.js";
import { runAs } from "./service-accounts.js";
import { consumeRateLimit } from "./rate-limit.js";
import { emailShell, escapeHtml, sendEmail } from "./ses.js";
import { tenantActor } from "./tenant-auth.js";
import { detectProofType } from "./generated/finance-payment-proof.js";

const db = () => getFirestore();
const OPTIONS = { ...ACCOUNT_CALL_OPTIONS, secrets: ["SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY"], ...runAs("contas") };
const UPLOAD_OPTIONS = { ...ACCOUNT_CALL_OPTIONS, ...runAs("contas"), memory: "512MiB" };
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const id = z.string().uuid();
const attachment = z.object({
  id,
  storagePath: z.string().min(1).max(500),
  name: z.string().trim().min(1).max(160),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]),
  size: z.number().int().positive().max(5 * 1024 * 1024),
}).strict();
const ticketSchema = z.object({
  ticketId: id,
  messageId: id,
  category: z.enum(SUPPORT_CATEGORIES),
  reportedSeverity: z.enum(SUPPORT_REPORTED_SEVERITIES),
  subject: z.string().trim().min(5).max(140),
  body: z.string().trim().min(10).max(5_000),
  attachments: z.array(attachment).max(5),
}).strict();
const replySchema = z.object({ ticketId: id, messageId: id, body: z.string().trim().min(1).max(5_000), attachments: z.array(attachment).max(5) }).strict();
const ticketIdSchema = z.object({ ticketId: id }).strict();
const updateSchema = z.object({ ticketId: id, priority: z.enum(SUPPORT_PRIORITIES).nullable().optional(), status: z.enum(SUPPORT_TICKET_STATUSES).optional() }).strict();
const emptySchema = z.object({}).strict();
const uploadSchema = z.object({
  ticketId: id, messageId: id, attachmentId: id,
  name: z.string().trim().min(1).max(160),
  file: z.string().min(8).max(Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 8).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();

function supportEmail() {
  return process.env.SUPPORT_NOTIFICATION_EMAIL ?? "guilhermeluizatto@gmail.com";
}

async function actorOf(request) {
  const account = await accountOf(request);
  if (account.platformRole === "PLATFORM_ADMIN") {
    await adminOf(request);
    return { kind: "SUPPORT", account, userId: request.auth.uid, organizationId: null, organization: null, membership: null, isHolder: false };
  }
  const actor = await tenantActor(request, "support:read");
  return { kind: "MEMBER", ...actor };
}

function attachmentPathOk(item, organizationId, ticketId, messageId) {
  return item.storagePath.startsWith(`support/${organizationId}/${ticketId}/${messageId}/`);
}

async function assertAttachments(items, organizationId, ticketId, messageId, actorId) {
  if (items.some((item) => !attachmentPathOk(item, organizationId, ticketId, messageId))) {
    throw new HttpsError("invalid-argument", "Um anexo não pertence a este chamado.");
  }
  if (new Set(items.map((item) => item.storagePath)).size !== items.length) {
    throw new HttpsError("invalid-argument", "Um anexo foi repetido.");
  }
  await Promise.all(items.map(async (item) => {
    let metadata;
    try { [metadata] = await getStorage().bucket().file(item.storagePath).getMetadata(); }
    catch { throw new HttpsError("invalid-argument", "Um anexo não foi enviado."); }
    const uploaded = metadata.metadata ?? {};
    if (item.storagePath !== `support/${organizationId}/${ticketId}/${messageId}/${item.id}`
      || uploaded.organizationId !== organizationId || uploaded.ticketId !== ticketId
      || uploaded.messageId !== messageId || uploaded.attachmentId !== item.id
      || uploaded.uploaderId !== actorId || uploaded.originalName !== item.name
      || metadata.contentType !== item.contentType || Number(metadata.size) !== item.size) {
      throw new HttpsError("invalid-argument", "Um anexo não corresponde a esta mensagem.");
    }
  }));
}

/** O backend verifica o arquivo antes de colocá-lo no caminho definitivo. */
export const uploadSupportAttachment = onCall(UPLOAD_OPTIONS, async (request) => {
  const actor = await actorOf(request);
  await consumeRateLimit(actor.userId, "supportWrite");
  const input = parse(uploadSchema, request.data);
  const ticket = (await db().doc(paths.platformSupportTicket(input.ticketId)).get()).data();
  let organizationId;
  if (ticket) {
    if (actor.kind !== "SUPPORT") {
      const manages = actor.isHolder || ["OWNER", "ADMIN"].includes(actor.membership.role);
      if (ticket.organizationId !== actor.organizationId || (!manages && ticket.openedBy !== actor.userId)) {
        throw new HttpsError("permission-denied", "Este chamado não pertence a você.");
      }
    }
    organizationId = ticket.organizationId;
  } else {
    if (actor.kind === "SUPPORT" || !actor.permissions.includes("support:create")) {
      throw new HttpsError("permission-denied", "Não é possível anexar a um chamado inexistente.");
    }
    organizationId = actor.organizationId;
  }
  const bytes = Buffer.from(input.file, "base64");
  if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new HttpsError("invalid-argument", "Envie um arquivo de até 5 MB.");
  }
  const contentType = detectProofType(new Uint8Array(bytes.subarray(0, 16)));
  if (!contentType) throw new HttpsError("invalid-argument", "Use PNG, JPEG, WebP ou PDF válido.");
  const storagePath = `support/${organizationId}/${input.ticketId}/${input.messageId}/${input.attachmentId}`;
  const file = getStorage().bucket().file(storagePath);
  const [exists] = await file.exists();
  if (exists) throw new HttpsError("already-exists", "Este anexo já foi enviado.");
  await file.save(bytes, { resumable: false, contentType, preconditionOpts: { ifGenerationMatch: 0 }, metadata: {
    cacheControl: "private, max-age=0",
    metadata: { organizationId, ticketId: input.ticketId, messageId: input.messageId,
      attachmentId: input.attachmentId, uploaderId: actor.userId, originalName: input.name },
  } });
  return { id: input.attachmentId, storagePath, name: input.name, contentType, size: bytes.length };
});

async function notify({ to, subject, body, organization }) {
  await sendEmail({
    to,
    subject,
    html: emailShell({ title: subject, organization, body: `<p>${escapeHtml(body)}</p><p>Entre no painel para ler e responder. O e-mail é somente uma notificação.</p>` }),
    text: `${body}\n\nEntre no painel para ler e responder. Este e-mail é somente uma notificação.`,
  });
}

export const createSupportTicket = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "support:create");
  await consumeRateLimit(actor.userId, "supportWrite");
  const input = parse(ticketSchema, request.data);
  await assertAttachments(input.attachments, actor.organizationId, input.ticketId, input.messageId, actor.userId);
  const createdAt = new Date().toISOString();
  const ticket = {
    id: input.ticketId,
    organizationId: actor.organizationId,
    organizationName: actor.organization.name,
    openedBy: actor.userId,
    openedByName: actor.account.displayName,
    openedByEmail: actor.account.email,
    category: input.category,
    reportedSeverity: input.reportedSeverity,
    priority: null,
    subject: input.subject,
    status: "WAITING_SUPPORT",
    lastMessageAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
  const message = {
    id: input.messageId, ticketId: input.ticketId, organizationId: actor.organizationId,
    authorId: actor.userId, authorName: actor.account.displayName, authorKind: "MEMBER",
    body: input.body, attachments: input.attachments, createdAt,
  };
  const batch = db().batch();
  batch.create(db().doc(paths.platformSupportTicket(input.ticketId)), toStored("platformSupportTickets", ticket));
  batch.create(db().doc(paths.platformSupportMessage(input.ticketId, input.messageId)), toStored("platformSupportMessages", message));
  await batch.commit();
  try {
    await notify({ to: supportEmail(), subject: `Novo chamado: ${input.subject}`, body: `${actor.organization.name} abriu um chamado.`, organization: actor.organization });
  } catch {
    await db().doc(paths.platformSupportTicket(input.ticketId)).update({ notificationDeliveryFailed: true });
  }
  return { ticketId: input.ticketId };
});

export const listSupportTickets = onCall(OPTIONS, async (request) => {
  const actor = await actorOf(request);
  parse(emptySchema, request.data);
  await consumeRateLimit(actor.userId, "supportRead");
  const query = actor.kind === "SUPPORT"
    ? db().collection(paths.platformSupportTickets()).orderBy("createdAt", "asc").limit(200)
    : actor.isHolder || ["OWNER", "ADMIN"].includes(actor.membership.role)
      ? db().collection(paths.platformSupportTickets()).where("organizationId", "==", actor.organizationId).orderBy("createdAt", "asc").limit(100)
      : db().collection(paths.platformSupportTickets()).where("organizationId", "==", actor.organizationId).where("openedBy", "==", actor.userId).orderBy("createdAt", "asc").limit(100);
  const snapshot = await query.get();
  return { tickets: snapshot.docs.map((document) => fromStored("platformSupportTickets", document.id, document.data())) };
});

export const getSupportThread = onCall(OPTIONS, async (request) => {
  const actor = await actorOf(request);
  await consumeRateLimit(actor.userId, "supportRead");
  const { ticketId } = parse(ticketIdSchema, request.data);
  const ticket = (await db().doc(paths.platformSupportTicket(ticketId)).get()).data();
  if (!ticket) throw new HttpsError("not-found", "Chamado não encontrado.");
  if (actor.kind !== "SUPPORT") {
    const managesOrganization = actor.isHolder || ["OWNER", "ADMIN"].includes(actor.membership.role);
    if (ticket.organizationId !== actor.organizationId || (!managesOrganization && ticket.openedBy !== actor.userId)) {
      throw new HttpsError("permission-denied", "Este chamado não pertence a você.");
    }
  }
  const messages = await db().collection(paths.platformSupportMessages(ticketId)).orderBy("createdAt", "asc").limit(500).get();
  return { ticket: fromStored("platformSupportTickets", ticketId, ticket), messages: messages.docs.map((document) => fromStored("platformSupportMessages", document.id, document.data())) };
});

export const replySupportTicket = onCall(OPTIONS, async (request) => {
  const actor = await actorOf(request);
  await consumeRateLimit(actor.userId, "supportWrite");
  const input = parse(replySchema, request.data);
  const ticketRef = db().doc(paths.platformSupportTicket(input.ticketId));
  const ticket = (await ticketRef.get()).data();
  if (!ticket) throw new HttpsError("not-found", "Chamado não encontrado.");
  if (actor.kind !== "SUPPORT") {
    const managesOrganization = actor.isHolder || ["OWNER", "ADMIN"].includes(actor.membership.role);
    if (ticket.organizationId !== actor.organizationId || (!managesOrganization && ticket.openedBy !== actor.userId)) throw new HttpsError("permission-denied", "Este chamado não pertence a você.");
  }
  await assertAttachments(input.attachments, ticket.organizationId, input.ticketId, input.messageId, actor.userId);
  const createdAt = new Date().toISOString();
  const message = {
    id: input.messageId, ticketId: input.ticketId, organizationId: ticket.organizationId,
    authorId: actor.userId, authorName: actor.account.displayName,
    authorKind: actor.kind, body: input.body, attachments: input.attachments, createdAt,
  };
  const batch = db().batch();
  batch.create(db().doc(paths.platformSupportMessage(input.ticketId, input.messageId)), toStored("platformSupportMessages", message));
  batch.update(ticketRef, { status: actor.kind === "SUPPORT" ? "WAITING_CUSTOMER" : "WAITING_SUPPORT", lastMessageAt: new Date(createdAt), updatedAt: new Date(createdAt) });
  await batch.commit();
  const destination = actor.kind === "SUPPORT" ? ticket.openedByEmail : supportEmail();
  try {
    await notify({ to: destination, subject: `Atualização no chamado: ${ticket.subject}`, body: actor.kind === "SUPPORT" ? "O suporte respondeu ao seu chamado." : `${ticket.organizationName} respondeu ao chamado.`, organization: actor.organization });
  } catch {
    await ticketRef.update({ notificationDeliveryFailed: true });
  }
  return { ok: true };
});

export const updateSupportTicket = onCall(OPTIONS, async (request) => {
  const actor = await actorOf(request);
  await consumeRateLimit(actor.userId, "supportWrite");
  if (actor.kind !== "SUPPORT") throw new HttpsError("permission-denied", "Somente o suporte define prioridade e situação.");
  const input = parse(updateSchema, request.data);
  const patch = { updatedAt: new Date(), updatedBy: actor.userId };
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.status !== undefined) patch.status = input.status;
  await db().doc(paths.platformSupportTicket(input.ticketId)).update(patch);
  return { ok: true };
});
