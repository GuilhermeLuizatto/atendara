import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { paths } from "./generated/paths.js";
import { ACCESS_GRANT_KINDS } from "./generated/platform-types.js";
import { ACCESS_GRANT_REASON_LENGTH } from "./generated/platform-config.js";
import { accessGrantWindowError, isGrantInForce, resolveAccountGate } from "./generated/access-gate.js";
import { ACCOUNT_CALL_OPTIONS, adminOf, parse } from "./platform-auth.js";

/**
 * Concessao manual de acesso e trilha da operadora.
 *
 * Estas callables sao de PLATAFORMA, nao de cobranca: so a operadora as chama,
 * com segundo fator. Sao, junto do webhook, os unicos caminhos que escrevem
 * `subscriptionStatus` e `accessUntil` (regra 10 do AGENTS.md), e cada ato
 * grava a propria entrada em `platformAuditLogs` na MESMA transacao — nao ha
 * concessao sem registro, nem registro de concessao que nao aconteceu.
 */

const db = () => getFirestore();

const reason = z.string().trim().min(ACCESS_GRANT_REASON_LENGTH.min).max(ACCESS_GRANT_REASON_LENGTH.max);
export const initialGrantSchema = z.object({ kind: z.enum(ACCESS_GRANT_KINDS), until: z.iso.datetime(), reason }).strict();
const grantSchema = initialGrantSchema.extend({ organizationId: z.string().min(1).max(128) }).strict();
const revokeSchema = z.object({ organizationId: z.string().min(1).max(128), reason }).strict();

export function assertGrantWindow(until, nowMs) {
  const error = accessGrantWindowError(until, nowMs);
  if (error) throw new HttpsError("invalid-argument", error);
}

/** Entrada da trilha. O chamador decide se entra num lote ou numa transacao. */
export function auditEntry({ action, actorId, organizationId = null, targetUserId = null, reason: why = null, details = {}, createdAt }) {
  const id = randomUUID();
  return {
    ref: db().doc(paths.platformAuditLog(id)),
    data: { id, action, actorId, organizationId, targetUserId, reason: why, details, createdAt },
  };
}

export function gateFields(gate) {
  return {
    subscriptionStatus: gate.subscriptionStatus,
    accessUntil: gate.accessUntil,
    accessUntilMs: gate.accessUntil ? Date.parse(gate.accessUntil) : 0,
  };
}

function subscriptionSource(subscription) {
  return subscription ? { status: subscription.status, accessUntil: subscription.accessUntil ?? null } : null;
}

export function grantDocument({ organizationId, subscriberUserId, input, actorId, stamp }) {
  return {
    organizationId,
    subscriberUserId,
    kind: input.kind,
    reason: input.reason.trim(),
    until: new Date(input.until).toISOString(),
    grantedBy: actorId,
    grantedAt: stamp,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  };
}

/**
 * A conta que recebe o portao e a do titular (`ownerId`), conferida contra o
 * proprio banco: a organizacao informada pela operadora so escolhe o tenant,
 * nunca uma conta de outro tenant nem a de uma operadora.
 */
async function readTitular(transaction, organizationId) {
  const organization = (await transaction.get(db().doc(paths.organization(organizationId)))).data();
  if (!organization?.ownerId) throw new HttpsError("not-found", "Organização não encontrada.");
  const accountRef = db().doc(paths.account(organization.ownerId));
  const account = (await transaction.get(accountRef)).data();
  if (!account || account.platformRole !== "PROFESSIONAL" || account.organizationId !== organizationId) {
    throw new HttpsError("failed-precondition", "O titular desta organização não tem conta profissional.");
  }
  return { accountRef, subscriberUserId: organization.ownerId };
}

export const grantAccess = onCall(ACCOUNT_CALL_OPTIONS, async (request) => {
  await adminOf(request);
  const input = parse(grantSchema, request.data);
  const nowMs = Date.now();
  assertGrantWindow(input.until, nowMs);

  const grantRef = db().doc(paths.platformAccessGrant(input.organizationId));
  const subscriptionRef = db().doc(paths.platformSubscription(input.organizationId));
  const result = await db().runTransaction(async (transaction) => {
    const { accountRef, subscriberUserId } = await readTitular(transaction, input.organizationId);
    const previous = (await transaction.get(grantRef)).data() ?? null;
    const subscription = (await transaction.get(subscriptionRef)).data() ?? null;

    const stamp = new Date(nowMs).toISOString();
    const grant = grantDocument({ organizationId: input.organizationId, subscriberUserId, input, actorId: request.auth.uid, stamp });
    const gate = resolveAccountGate({ subscription: subscriptionSource(subscription), grant, nowMs });
    const entry = auditEntry({
      action: "ACCESS_GRANTED",
      actorId: request.auth.uid,
      organizationId: input.organizationId,
      targetUserId: subscriberUserId,
      reason: grant.reason,
      details: {
        kind: grant.kind,
        until: grant.until,
        replacedUntil: previous && isGrantInForce(previous, nowMs) ? previous.until : null,
        resultingAccessUntil: gate.accessUntil,
      },
      createdAt: stamp,
    });

    transaction.set(grantRef, grant);
    transaction.update(accountRef, gateFields(gate));
    transaction.create(entry.ref, entry.data);
    return { until: grant.until, accessUntil: gate.accessUntil };
  });
  return { ok: true, ...result };
});

/**
 * Revogacao antecipada. Fecha so a parte concedida: com assinatura paga
 * vigente, o portao volta a ser exatamente o que o gateway decidiu.
 */
export const revokeAccess = onCall(ACCOUNT_CALL_OPTIONS, async (request) => {
  await adminOf(request);
  const input = parse(revokeSchema, request.data);
  const nowMs = Date.now();

  const grantRef = db().doc(paths.platformAccessGrant(input.organizationId));
  const subscriptionRef = db().doc(paths.platformSubscription(input.organizationId));
  const result = await db().runTransaction(async (transaction) => {
    const { accountRef, subscriberUserId } = await readTitular(transaction, input.organizationId);
    const grant = (await transaction.get(grantRef)).data() ?? null;
    const subscription = (await transaction.get(subscriptionRef)).data() ?? null;
    if (!isGrantInForce(grant, nowMs)) {
      throw new HttpsError("failed-precondition", "Não há concessão vigente para esta organização.");
    }

    const stamp = new Date(nowMs).toISOString();
    const gate = resolveAccountGate({ subscription: subscriptionSource(subscription), grant: null, nowMs });
    const entry = auditEntry({
      action: "ACCESS_REVOKED",
      actorId: request.auth.uid,
      organizationId: input.organizationId,
      targetUserId: subscriberUserId,
      reason: input.reason.trim(),
      details: { kind: grant.kind, until: grant.until, resultingAccessUntil: gate.accessUntil },
      createdAt: stamp,
    });

    transaction.update(grantRef, { revokedAt: stamp, revokedBy: request.auth.uid, revokeReason: input.reason.trim() });
    transaction.update(accountRef, gateFields(gate));
    transaction.create(entry.ref, entry.data);
    return { accessUntil: gate.accessUntil };
  });
  return { ok: true, ...result };
});
