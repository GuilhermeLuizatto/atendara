import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { randomUUID } from "node:crypto";

import { paths } from "./generated/paths.js";
import { permissionsForMembership } from "./generated/permissions.js";
import { accountOf } from "./platform-auth.js";

const db = () => getFirestore();

/** Resolve conta, organizacao e vinculo sem confiar em organizationId do cliente. */
export async function tenantActor(request, permission = null) {
  const account = await accountOf(request);
  if (account.platformRole !== "PROFESSIONAL" || !account.organizationId) {
    throw new HttpsError("permission-denied", "Esta operação pertence a uma organização.");
  }
  const organizationRef = db().doc(paths.organization(account.organizationId));
  const membershipRef = db().doc(paths.document(account.organizationId, "members", request.auth.uid));
  const [organizationSnapshot, membershipSnapshot] = await Promise.all([
    organizationRef.get(),
    membershipRef.get(),
  ]);
  const organization = organizationSnapshot.data();
  const membership = membershipSnapshot.data();
  if (!organization || !membership || membership.status !== "ACTIVE") {
    throw new HttpsError("permission-denied", "Vínculo com a organização não está ativo.");
  }
  const isHolder = organization.ownerId === request.auth.uid;
  const permissions = permissionsForMembership(membership.role, isHolder);
  if (permission && !permissions.includes(permission)) {
    throw new HttpsError("permission-denied", "Seu papel não permite esta operação.");
  }
  return {
    account,
    organization,
    organizationId: account.organizationId,
    membership,
    isHolder,
    permissions,
    userId: request.auth.uid,
  };
}

export function tenantAudit({ organizationId, actorId, action, resourceType, resourceId, summary, metadata = {} }) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    organizationId,
    actorType: "USER",
    actorId,
    actorName: "Usuário",
    action,
    resource: { type: resourceType, id: resourceId },
    summary,
    metadata,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
  };
}
