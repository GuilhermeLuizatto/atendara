import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { ACCOUNT_CALL_OPTIONS, adminOf, parse } from "./platform-auth.js";
import { passwordPolicyError } from "./generated/password-policy.js";
import { TEAM_ADMIN_REASON_LENGTH } from "./generated/platform-config.js";
import { paths } from "./generated/paths.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { auditEntry } from "./platform.js";
import { runAs } from "./service-accounts.js";
import { consumeRateLimit, networkSubject } from "./rate-limit.js";
import { escapeHtml, emailShell, sendEmail } from "./ses.js";
import { tenantActor, tenantAudit } from "./tenant-auth.js";

const db = () => getFirestore();
const SECRETS = ["SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY"];
const OPTIONS = { ...ACCOUNT_CALL_OPTIONS, secrets: SECRETS, ...runAs("contas") };
const INVITATION_DAYS = 7;
const id = z.string().trim().min(1).max(128).refine((value) => !value.includes("/"));
const email = z.email().trim().toLowerCase();
const role = z.enum(["PROFESSIONAL", "ASSISTANT"]);
const linked = z.array(id).max(50);
const requestSchema = z.object({
  displayName: z.string().trim().min(3).max(100),
  email,
  role,
  linkedProfessionalIds: linked,
}).strict();
const reason = z.string().trim().min(TEAM_ADMIN_REASON_LENGTH.min).max(TEAM_ADMIN_REASON_LENGTH.max);
const platformDecisionSchema = z.object({
  organizationId: id,
  requestId: id,
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason,
}).strict();
const platformMemberStatusSchema = z.object({
  organizationId: id,
  memberId: id,
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason,
}).strict();
const platformMemberRemovalSchema = z.object({ organizationId: id, memberId: id, reason }).strict();
const invitationTokenSchema = z.object({ token: z.string().min(32).max(512) }).strict();
const acceptSchema = invitationTokenSchema.extend({
  password: z.string().min(1).max(128),
  profession: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  licenseNumber: z.string().trim().max(60).optional().nullable(),
  specialties: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
}).strict();
const emptySchema = z.object({}).strict();

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function now() {
  return new Date().toISOString();
}

function addInvitationDays(at) {
  return new Date(Date.parse(at) + INVITATION_DAYS * 86_400_000).toISOString();
}

async function validateLinkedProfessionals(organizationId, ids) {
  const unique = [...new Set(ids)];
  const documents = await Promise.all(unique.map((value) => db().doc(paths.document(organizationId, "professionals", value)).get()));
  if (documents.some((document) => !document.exists || document.data().active === false)) {
    throw new HttpsError("failed-precondition", "Escolha somente profissionais ativos desta organização.");
  }
  return unique;
}

async function ensureEmailAvailable(address) {
  try {
    await getAuth().getUserByEmail(address);
    throw new HttpsError("already-exists", "Este e-mail já pertence a uma conta do Atendara e não pode entrar em outra organização.");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error?.code !== "auth/user-not-found") throw new HttpsError("internal", "Não foi possível conferir o e-mail.");
  }
}

function invitationDraft(actor, input, token, createdAt = now()) {
  return {
    id: randomUUID(),
    organizationId: actor.organizationId,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    linkedProfessionalIds: input.linkedProfessionalIds,
    status: "PENDING",
    invitedBy: actor.userId,
    tokenHash: tokenHash(token),
    expiresAt: addInvitationDays(createdAt),
    acceptedAt: null,
    createdAt,
    updatedAt: createdAt,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  };
}

async function deliverInvitation(invitation, token, organization) {
  const baseUrl = (process.env.APP_BASE_URL ?? "https://atendo-a3481.web.app").replace(/\/$/, "");
  const url = `${baseUrl}/convite/?token=${encodeURIComponent(token)}`;
  const title = `Convite para ${organization.name}`;
  const safeName = escapeHtml(invitation.displayName);
  await sendEmail({
    to: invitation.email,
    subject: `${title} no Atendara`,
    html: emailShell({
      title,
      organization,
      body: `<p>Olá, ${safeName}.</p><p>Você recebeu um convite para participar de <strong>${escapeHtml(organization.name)}</strong>.</p><p><a href="${escapeHtml(url)}">Confirmar e criar minha senha</a></p><p>O link vence em ${INVITATION_DAYS} dias e só pode ser usado uma vez.</p>`,
    }),
    text: `Olá, ${invitation.displayName}. Confirme o convite para ${organization.name} e crie sua senha: ${url}\nO link vence em ${INVITATION_DAYS} dias.`,
  });
}

export const listTeam = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "member:read");
  parse(emptySchema, request.data);
  await consumeRateLimit(actor.userId, "teamRead");
  const [membersSnapshot, professionalsSnapshot, requestsSnapshot, invitationsSnapshot] = await Promise.all([
    db().collection(paths.collection(actor.organizationId, "members")).get(),
    db().collection(paths.collection(actor.organizationId, "professionals")).get(),
    db().collection(paths.collection(actor.organizationId, "memberRequests")).orderBy("createdAt", "desc").limit(100).get(),
    db().collection(paths.collection(actor.organizationId, "memberInvitations")).orderBy("createdAt", "desc").limit(100).get(),
  ]);
  const accountDocuments = await Promise.all(membersSnapshot.docs.map((member) => db().doc(paths.account(member.id)).get()));
  const accounts = new Map(accountDocuments.filter((document) => document.exists).map((document) => [document.id, document.data()]));
  return {
    members: membersSnapshot.docs.map((document) => ({ ...fromStored("members", document.id, document.data()), account: accounts.get(document.id) ? { displayName: accounts.get(document.id).displayName, email: accounts.get(document.id).email } : null })),
    professionals: professionalsSnapshot.docs.map((document) => fromStored("professionals", document.id, document.data())),
    requests: requestsSnapshot.docs.map((document) => fromStored("memberRequests", document.id, document.data())),
    invitations: invitationsSnapshot.docs.map((document) => { const { tokenHash: omitted, ...safe } = fromStored("memberInvitations", document.id, document.data()); void omitted; return safe; }),
  };
});

export const requestTeamMember = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "member:request");
  await consumeRateLimit(actor.userId, "teamWrite");
  const input = parse(requestSchema, request.data);
  await ensureEmailAvailable(input.email);
  const ownProfessional = await db().collection(paths.collection(actor.organizationId, "professionals")).where("userId", "==", actor.userId).limit(1).get();
  if (ownProfessional.empty) throw new HttpsError("failed-precondition", "Seu perfil profissional não foi encontrado.");
  const linkedProfessionalIds = await validateLinkedProfessionals(actor.organizationId, [...input.linkedProfessionalIds, ownProfessional.docs[0].id]);
  const createdAt = now();
  const record = {
    id: randomUUID(), organizationId: actor.organizationId, requestedBy: actor.userId,
    ...input, linkedProfessionalIds, status: "PENDING", decidedBy: null,
    decisionReason: null, createdAt, updatedAt: createdAt, createdBy: actor.userId, updatedBy: actor.userId,
  };
  await db().doc(paths.document(actor.organizationId, "memberRequests", record.id)).create(toStored("memberRequests", record));
  return { requestId: record.id };
});

/**
 * Visao administrativa minima da equipe. A operadora recebe apenas metadados
 * de conta, vinculo e solicitacao; agenda, clientes, mensagens e financeiro
 * nunca entram na resposta.
 */
export const listPlatformTeamAdministration = onCall(OPTIONS, async (request) => {
  const actor = await adminOf(request);
  parse(emptySchema, request.data);
  await consumeRateLimit(actor.userId, "platformTeamRead");
  const [requestsSnapshot, membersSnapshot] = await Promise.all([
    db().collectionGroup("memberRequests").where("status", "==", "PENDING").limit(100).get(),
    db().collectionGroup("members").where("status", "in", ["ACTIVE", "SUSPENDED"]).limit(200).get(),
  ]);
  const entries = [...requestsSnapshot.docs, ...membersSnapshot.docs];
  const organizationIds = [...new Set(entries.map((document) => document.ref.parent.parent?.id).filter(Boolean))];
  const organizations = new Map((await Promise.all(organizationIds.map((organizationId) => db().doc(paths.organization(organizationId)).get())))
    .filter((document) => document.exists).map((document) => [document.id, document.data()]));
  const accountIds = [...new Set(membersSnapshot.docs.map((document) => document.id))];
  const accounts = new Map((await Promise.all(accountIds.map((userId) => db().doc(paths.account(userId)).get())))
    .filter((document) => document.exists).map((document) => [document.id, document.data()]));
  const organizationOf = (document) => {
    const organizationId = document.ref.parent.parent?.id;
    const organization = organizationId ? organizations.get(organizationId) : null;
    return { organizationId, organizationName: organization?.name ?? "Organização", ownerId: organization?.ownerId ?? null };
  };
  return {
    requests: requestsSnapshot.docs
      .map((document) => ({ ...fromStored("memberRequests", document.id, document.data()), ...organizationOf(document) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    members: membersSnapshot.docs
      .map((document) => {
        const organization = organizationOf(document);
        const account = accounts.get(document.id);
        return {
          ...fromStored("members", document.id, document.data()),
          ...organization,
          isOrganizationHolder: organization.ownerId === document.id,
          account: account ? { displayName: account.displayName, email: account.email } : null,
        };
      })
      .sort((a, b) => a.organizationName.localeCompare(b.organizationName) || (a.account?.displayName ?? "").localeCompare(b.account?.displayName ?? "")),
  };
});

export const decidePlatformTeamRequest = onCall(OPTIONS, async (request) => {
  const actor = await adminOf(request);
  await consumeRateLimit(actor.userId, "platformTeamWrite");
  const input = parse(platformDecisionSchema, request.data);
  const organization = (await db().doc(paths.organization(input.organizationId)).get()).data();
  if (!organization) throw new HttpsError("not-found", "Organização não encontrada.");
  const ref = db().doc(paths.document(input.organizationId, "memberRequests", input.requestId));
  const record = (await ref.get()).data();
  if (!record || record.organizationId !== input.organizationId || record.status !== "PENDING") {
    throw new HttpsError("failed-precondition", "Esta solicitação já foi decidida ou não existe.");
  }
  const createdAt = now();
  const action = input.decision === "APPROVED" ? "TEAM_REQUEST_APPROVED" : "TEAM_REQUEST_REJECTED";
  const entry = auditEntry({
    action,
    actorId: actor.userId,
    organizationId: input.organizationId,
    reason: input.reason,
    details: { requestId: input.requestId, role: record.role, requestedBy: record.requestedBy },
    createdAt,
  });
  if (input.decision === "REJECTED") {
    const batch = db().batch();
    batch.update(ref, { status: "REJECTED", decidedBy: actor.userId, decisionReason: input.reason, updatedAt: new Date(createdAt), updatedBy: actor.userId });
    batch.create(entry.ref, entry.data);
    await batch.commit();
    return { invitationId: null, expiresAt: null };
  }

  await ensureEmailAvailable(record.email);
  const linkedProfessionalIds = await validateLinkedProfessionals(input.organizationId, record.linkedProfessionalIds ?? []);
  const token = randomBytes(32).toString("base64url");
  const invitation = invitationDraft(
    { organizationId: input.organizationId, userId: actor.userId },
    { ...record, linkedProfessionalIds },
    token,
    createdAt,
  );
  const invitationRef = db().doc(paths.document(input.organizationId, "memberInvitations", invitation.id));
  const previous = await db().collection(paths.collection(input.organizationId, "memberInvitations"))
    .where("email", "==", record.email).get();
  const batch = db().batch();
  for (const document of previous.docs.filter((item) => item.data().status === "PENDING")) {
    batch.update(document.ref, { status: "REVOKED", tokenHash: null, updatedAt: new Date(createdAt), updatedBy: actor.userId });
  }
  batch.create(invitationRef, toStored("memberInvitations", invitation));
  batch.update(ref, { status: "APPROVED", decidedBy: actor.userId, decisionReason: input.reason, updatedAt: new Date(createdAt), updatedBy: actor.userId });
  batch.create(entry.ref, entry.data);
  await batch.commit();
  try {
    await deliverInvitation(invitation, token, organization);
  } catch {
    await invitationRef.update({ status: "DELIVERY_FAILED", updatedAt: new Date() });
    throw new HttpsError("unavailable", "A solicitação foi aprovada, mas o e-mail não saiu. Confira o SES antes de reenviar.");
  }
  return { invitationId: invitation.id, expiresAt: invitation.expiresAt };
});

export const inspectTeamInvitation = onCall(OPTIONS, async (request) => {
  await consumeRateLimit(networkSubject(request), "teamInvitationByNetwork");
  const { token } = parse(invitationTokenSchema, request.data);
  const matches = await db().collectionGroup("memberInvitations").where("tokenHash", "==", tokenHash(token)).limit(1).get();
  if (matches.empty) throw new HttpsError("not-found", "Convite inválido ou já utilizado.");
  const invitation = matches.docs[0].data();
  if (invitation.status !== "PENDING" || Date.parse(invitation.expiresAt.toDate?.().toISOString?.() ?? invitation.expiresAt) <= Date.now()) {
    throw new HttpsError("failed-precondition", "Este convite venceu ou já foi utilizado.");
  }
  const organization = (await db().doc(paths.organization(invitation.organizationId)).get()).data();
  return { email: invitation.email, displayName: invitation.displayName, role: invitation.role, organizationName: organization?.name ?? "Organização", professions: organization?.professions ?? [] };
});

export const acceptTeamInvitation = onCall(OPTIONS, async (request) => {
  await consumeRateLimit(networkSubject(request), "teamInvitationByNetwork");
  const input = parse(acceptSchema, request.data);
  const weak = passwordPolicyError(input.password);
  if (weak) throw new HttpsError("invalid-argument", weak);
  const matches = await db().collectionGroup("memberInvitations").where("tokenHash", "==", tokenHash(input.token)).limit(1).get();
  if (matches.empty) throw new HttpsError("not-found", "Convite inválido ou já utilizado.");
  const invitationRef = matches.docs[0].ref;
  const invitation = matches.docs[0].data();
  const expiresAt = invitation.expiresAt.toDate?.().toISOString?.() ?? invitation.expiresAt;
  if (invitation.status !== "PENDING" || Date.parse(expiresAt) <= Date.now()) throw new HttpsError("failed-precondition", "Este convite venceu ou já foi utilizado.");
  await ensureEmailAvailable(invitation.email);
  const organization = (await db().doc(paths.organization(invitation.organizationId)).get()).data();
  if (!organization) throw new HttpsError("not-found", "Organização não encontrada.");
  if (invitation.role === "PROFESSIONAL" && (!input.profession || !organization.professions.includes(input.profession))) {
    throw new HttpsError("invalid-argument", "Escolha uma profissão habilitada pela organização.");
  }
  const ownerAccount = (await db().doc(paths.account(organization.ownerId)).get()).data();
  if (!ownerAccount) throw new HttpsError("failed-precondition", "O acesso da organização não foi encontrado.");
  const user = await getAuth().createUser({ email: invitation.email, displayName: invitation.displayName, password: input.password, emailVerified: true });
  const createdAt = now();
  const stamp = { createdAt, updatedAt: createdAt, createdBy: invitation.invitedBy, updatedBy: invitation.invitedBy };
  const account = {
    userId: user.uid, email: invitation.email, displayName: invitation.displayName,
    platformRole: "PROFESSIONAL", organizationId: invitation.organizationId,
    professionId: invitation.role === "PROFESSIONAL" ? input.profession : organization.primaryProfession,
    modules: ownerAccount.modules ?? [], status: "ACTIVE",
    subscriptionStatus: ownerAccount.subscriptionStatus, accessUntil: ownerAccount.accessUntil,
    accessUntilMs: ownerAccount.accessUntilMs ?? 0, mustChangePassword: false,
    origin: "INVITATION", createdAt,
  };
  const membership = {
    id: user.uid, userId: user.uid, organizationId: invitation.organizationId,
    role: invitation.role, status: "ACTIVE", invitedBy: invitation.invitedBy,
    linkedProfessionalIds: [...new Set([
      ...(invitation.linkedProfessionalIds ?? []),
      ...(invitation.role === "PROFESSIONAL" ? [user.uid] : []),
    ])],
    removedAt: null, ...stamp,
  };
  const batch = db().batch();
  batch.create(db().doc(paths.account(user.uid)), account);
  batch.create(db().doc(paths.document(invitation.organizationId, "members", user.uid)), toStored("members", membership));
  if (invitation.role === "PROFESSIONAL") {
    batch.create(db().doc(paths.document(invitation.organizationId, "professionals", user.uid)), toStored("professionals", {
      id: user.uid, organizationId: invitation.organizationId, userId: user.uid,
      displayName: invitation.displayName, email: invitation.email, phone: input.phone ?? null,
      profession: input.profession, licenseNumber: input.licenseNumber ?? null,
      specialties: input.specialties ?? [], avatarUrl: null, active: true, ...stamp,
    }));
  }
  batch.update(invitationRef, { status: "ACCEPTED", acceptedAt: new Date(createdAt), updatedAt: new Date(createdAt), updatedBy: user.uid, tokenHash: null });
  const audit = tenantAudit({ organizationId: invitation.organizationId, actorId: user.uid, action: "CREATE", resourceType: "member", resourceId: user.uid, summary: "Convite de equipe aceito.", metadata: { role: invitation.role } });
  batch.create(db().doc(paths.document(invitation.organizationId, "auditLogs", audit.id)), toStored("auditLogs", audit));
  try { await batch.commit(); } catch { await getAuth().deleteUser(user.uid); throw new HttpsError("internal", "Não foi possível concluir o convite."); }
  return { ok: true };
});

export const setPlatformTeamMemberStatus = onCall(OPTIONS, async (request) => {
  const actor = await adminOf(request);
  await consumeRateLimit(actor.userId, "platformTeamWrite");
  const input = parse(platformMemberStatusSchema, request.data);
  const organization = (await db().doc(paths.organization(input.organizationId)).get()).data();
  if (!organization) throw new HttpsError("not-found", "Organização não encontrada.");
  if (input.memberId === organization.ownerId) throw new HttpsError("failed-precondition", "O titular não pode ser suspenso.");
  const ref = db().doc(paths.document(input.organizationId, "members", input.memberId));
  const changed = await db().runTransaction(async (transaction) => {
    const target = (await transaction.get(ref)).data();
    if (!target || target.organizationId !== input.organizationId || target.status === "REMOVED") {
      throw new HttpsError("not-found", "Membro não encontrado.");
    }
    if (target.status === input.status) return false;
    const createdAt = now();
    const entry = auditEntry({
      action: input.status === "SUSPENDED" ? "TEAM_MEMBER_SUSPENDED" : "TEAM_MEMBER_REACTIVATED",
      actorId: actor.userId,
      organizationId: input.organizationId,
      targetUserId: input.memberId,
      reason: input.reason,
      details: { role: target.role, status: { from: target.status, to: input.status } },
      createdAt,
    });
    transaction.update(ref, { status: input.status, updatedAt: new Date(createdAt), updatedBy: actor.userId });
    transaction.create(entry.ref, entry.data);
    return true;
  });
  if (changed) {
    await getAuth().updateUser(input.memberId, { disabled: input.status === "SUSPENDED" });
    if (input.status === "SUSPENDED") await getAuth().revokeRefreshTokens(input.memberId);
  }
  return { ok: true };
});

export const removePlatformTeamMember = onCall(OPTIONS, async (request) => {
  const actor = await adminOf(request);
  await consumeRateLimit(actor.userId, "platformTeamWrite");
  const input = parse(platformMemberRemovalSchema, request.data);
  const organization = (await db().doc(paths.organization(input.organizationId)).get()).data();
  if (!organization) throw new HttpsError("not-found", "Organização não encontrada.");
  if (input.memberId === organization.ownerId) {
    throw new HttpsError("failed-precondition", "O titular é intransferível e não pode ser removido.");
  }
  const membershipRef = db().doc(paths.document(input.organizationId, "members", input.memberId));
  const membership = (await membershipRef.get()).data();
  if (!membership || membership.organizationId !== input.organizationId) {
    throw new HttpsError("not-found", "Membro não encontrado.");
  }
  if (membership.status === "REMOVED") {
    try { await getAuth().deleteUser(input.memberId); } catch (error) { if (error?.code !== "auth/user-not-found") throw error; }
    return { ok: true };
  }

  try {
    await getAuth().updateUser(input.memberId, { disabled: true });
    await getAuth().revokeRefreshTokens(input.memberId);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
  }

  const removedAt = now();
  const pseudonym = `removido-${createHash("sha256").update(`${input.organizationId}:${input.memberId}`).digest("hex").slice(0, 12)}`;
  const batch = db().batch();
  batch.update(membershipRef, {
    userId: null,
    status: "REMOVED",
    invitedBy: null,
    linkedProfessionalIds: [],
    removedAt: new Date(removedAt),
    updatedAt: new Date(removedAt),
    updatedBy: actor.userId,
  });
  const professionalRef = db().doc(paths.document(input.organizationId, "professionals", input.memberId));
  const professional = await professionalRef.get();
  if (professional.exists) {
    batch.update(professionalRef, {
      userId: null,
      displayName: "Profissional removido",
      email: `${pseudonym}@removed.atendara.invalid`,
      phone: null,
      licenseNumber: null,
      specialties: [],
      avatarUrl: null,
      active: false,
      updatedAt: new Date(removedAt),
      updatedBy: actor.userId,
    });
  }
  batch.set(db().doc(paths.account(input.memberId)), {
    email: `${pseudonym}@removed.atendara.invalid`,
    displayName: "Membro removido",
    status: "SUSPENDED",
    modules: [],
    mustChangePassword: false,
    removedAt,
  }, { merge: true });
  const tenantEntry = tenantAudit({
    organizationId: input.organizationId,
    actorId: actor.userId,
    action: "PERMISSION_CHANGED",
    resourceType: "member",
    resourceId: input.memberId,
    summary: "Membro removido pela administração da Atendara e cadastro pseudonimizado.",
    metadata: { previousRole: membership.role },
  });
  batch.create(db().doc(paths.document(input.organizationId, "auditLogs", tenantEntry.id)), toStored("auditLogs", tenantEntry));
  const platformEntry = auditEntry({
    action: "TEAM_MEMBER_REMOVED",
    actorId: actor.userId,
    organizationId: input.organizationId,
    targetUserId: input.memberId,
    reason: input.reason,
    details: { previousRole: membership.role },
    createdAt: removedAt,
  });
  batch.create(platformEntry.ref, platformEntry.data);
  await batch.commit();

  try {
    await getAuth().deleteUser(input.memberId);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw new HttpsError("unavailable", "O acesso foi removido, mas o login ainda aguarda limpeza administrativa.");
    }
  }
  return { ok: true };
});
