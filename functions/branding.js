import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { ACCOUNT_CALL_OPTIONS, parse } from "./platform-auth.js";
import { paths } from "./generated/paths.js";
import { toStored } from "./firestore-dates.js";
import { runAs } from "./service-accounts.js";
import { consumeRateLimit } from "./rate-limit.js";
import { tenantActor, tenantAudit } from "./tenant-auth.js";
import { detectProofType } from "./generated/finance-payment-proof.js";

const OPTIONS = { ...ACCOUNT_CALL_OPTIONS, ...runAs("contas") };
const UPLOAD_OPTIONS = { ...OPTIONS, memory: "512MiB" };
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const db = () => getFirestore();
const schema = z.object({
  logoUrl: z.null(), logoStoragePath: z.null(), logoContentType: z.null(),
}).strict();
const uploadSchema = z.object({ file: z.string().min(8).max(Math.ceil(MAX_LOGO_BYTES * 4 / 3) + 8).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();

/** Grava o logo já validado e troca a referência no mesmo ato auditado. */
export const uploadBrandingLogo = onCall(UPLOAD_OPTIONS, async (request) => {
  const actor = await tenantActor(request, "organizationBranding:update");
  await consumeRateLimit(actor.userId, "organizationBranding");
  const input = parse(uploadSchema, request.data);
  const bytes = Buffer.from(input.file, "base64");
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) throw new HttpsError("invalid-argument", "O logo deve ter até 2 MB.");
  const contentType = detectProofType(new Uint8Array(bytes.subarray(0, 16)));
  if (!contentType || !["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
    throw new HttpsError("invalid-argument", "Use PNG, JPEG ou WebP válido.");
  }
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[contentType];
  const storagePath = `branding/${actor.organizationId}/logo/${randomUUID()}.${extension}`;
  const bucket = getStorage().bucket();
  const token = randomUUID();
  const file = bucket.file(storagePath);
  await file.save(bytes, { resumable: false, contentType, metadata: {
    cacheControl: "private, max-age=0", metadata: { firebaseStorageDownloadTokens: token },
  } });
  const logoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  const updatedAt = new Date().toISOString();
  const branding = { logoUrl, logoStoragePath: storagePath, logoContentType: contentType, updatedAt };
  const audit = tenantAudit({ organizationId: actor.organizationId, actorId: actor.userId, action: "UPDATE", resourceType: "organizationBranding", resourceId: actor.organizationId, summary: "Logo da organização atualizado." });
  let previous;
  try {
    previous = await db().runTransaction(async (transaction) => {
      const orgRef = db().doc(paths.organization(actor.organizationId));
      const old = (await transaction.get(orgRef)).data()?.branding?.logoStoragePath ?? null;
      transaction.update(orgRef, { branding, updatedAt: new Date(updatedAt), updatedBy: actor.userId });
      transaction.create(db().doc(paths.document(actor.organizationId, "auditLogs", audit.id)), toStored("auditLogs", audit));
      return old;
    });
  } catch (error) {
    await file.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  if (previous && previous !== storagePath && previous.startsWith(`branding/${actor.organizationId}/logo/`)) {
    await bucket.file(previous).delete({ ignoreNotFound: true }).catch(() => undefined);
  }
  return { branding };
});

export const updateOrganizationBranding = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "organizationBranding:update");
  await consumeRateLimit(actor.userId, "organizationBranding");
  const input = parse(schema, request.data);
  const updatedAt = new Date().toISOString();
  const branding = { ...input, updatedAt };
  const audit = tenantAudit({ organizationId: actor.organizationId, actorId: actor.userId, action: "UPDATE", resourceType: "organizationBranding", resourceId: actor.organizationId, summary: "Logo da organização removido." });
  const previous = await db().runTransaction(async (transaction) => {
    const orgRef = db().doc(paths.organization(actor.organizationId));
    const old = (await transaction.get(orgRef)).data()?.branding?.logoStoragePath ?? null;
    transaction.update(orgRef, { branding, updatedAt: new Date(updatedAt), updatedBy: actor.userId });
    transaction.create(db().doc(paths.document(actor.organizationId, "auditLogs", audit.id)), toStored("auditLogs", audit));
    return old;
  });
  if (previous && previous.startsWith(`branding/${actor.organizationId}/logo/`)) {
    await getStorage().bucket().file(previous).delete({ ignoreNotFound: true }).catch(() => undefined);
  }
  return { branding };
});
