import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { ACCOUNT_CALL_OPTIONS, parse } from "./platform-auth.js";
import { paths } from "./generated/paths.js";
import { toStored } from "./firestore-dates.js";
import { runAs } from "./service-accounts.js";
import { consumeRateLimit } from "./rate-limit.js";
import { tenantActor, tenantAudit } from "./tenant-auth.js";

const OPTIONS = { ...ACCOUNT_CALL_OPTIONS, ...runAs("contas") };
const FIREBASE_STORAGE_HOST = "firebasestorage.googleapis.com";
const db = () => getFirestore();
const schema = z.object({
  logoUrl: z.url().max(2_000).nullable(),
  logoStoragePath: z.string().max(500).nullable(),
  logoContentType: z.enum(["image/png", "image/jpeg", "image/webp"]).nullable(),
}).strict();

export const updateOrganizationBranding = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "organizationBranding:update");
  await consumeRateLimit(actor.userId, "organizationBranding");
  const input = parse(schema, request.data);
  const removing = input.logoUrl === null && input.logoStoragePath === null && input.logoContentType === null;
  if (!removing) {
    if (!input.logoUrl || !input.logoStoragePath || !input.logoContentType) throw new HttpsError("invalid-argument", "O logo está incompleto.");
    if (!input.logoStoragePath.startsWith(`branding/${actor.organizationId}/`)) throw new HttpsError("invalid-argument", "O arquivo não pertence a esta organização.");
    const parsed = new URL(input.logoUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== FIREBASE_STORAGE_HOST) throw new HttpsError("invalid-argument", "O endereço do logo não é aceito.");
  }
  const updatedAt = new Date().toISOString();
  const branding = { ...input, updatedAt };
  const audit = tenantAudit({ organizationId: actor.organizationId, actorId: actor.userId, action: "UPDATE", resourceType: "organizationBranding", resourceId: actor.organizationId, summary: removing ? "Logo da organização removido." : "Logo da organização atualizado." });
  await db().runTransaction(async (transaction) => {
    transaction.update(db().doc(paths.organization(actor.organizationId)), { branding, updatedAt: new Date(updatedAt), updatedBy: actor.userId });
    transaction.create(db().doc(paths.document(actor.organizationId, "auditLogs", audit.id)), toStored("auditLogs", audit));
  });
  return { branding };
});
