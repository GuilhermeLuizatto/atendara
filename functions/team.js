import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

import { ACCOUNT_CALL_OPTIONS, parse } from "./platform-auth.js";
import { passwordPolicyError } from "./generated/password-policy.js";
import { paths } from "./generated/paths.js";
import { fromStored, toStored } from "./firestore-dates.js";
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
const role = z.enum(["ADMIN", "PROFESSIONAL", "ASSISTANT", "VIEWER"]);
const linked = z.array(id).max(50);
const inviteSchema = z.object({
  displayName: z.string().trim().min(3).max(100),
  email,
  role,
  linkedProfessionalIds: linked,
}).strict();
const requestSchema = inviteSchema.extend({ role: z.enum(["PROFESSIONAL", "ASSISTANT", "VIEWER"]) }).strict();
const decisionSchema = z.object({ requestId: id, decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().max(300) }).strict();
const invitationTokenSchema = z.object({ token: z.string().min(32).max(512) }).strict();
const acceptSchema = invitationTokenSchema.extend({
  password: z.string().min(1).max(128),
  profession: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  licenseNumber: z.string().trim().max(60).optional().nullable(),
  specialties: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
}).strict();
const memberSchema = z.object({ memberId: id, status: z.enum(["ACTIVE", "SUSPENDED"]).optional() }).strict();
const memberStatusSchema = z.object({ memberId: id, status: z.enum(["ACTIVE", "SUSPENDED"]) }).strict();
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

function authorizeRole(actor, targetRole) {
  if (targetRole === "OWNER") throw new HttpsError("invalid-argument", "O titular da organização é intransferível.");
  if (targetRole === "ADMIN" && !actor.isHolder && actor.membership.role !== "OWNER") {
    throw new HttpsError("permission-denied", "Somente o titular gerencia administradores.");
  }
}

function invitationDraft(actor, input, token, createdAt = now()) {
  return {
    id: randomUUID(),
    organizationId: actor.organizationId,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    linkedProfessionalIds: input.role === "ADMIN" ? [] : input.linkedProfessionalIds,
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

async function createAndSendInvitation(actor, input) {
  authorizeRole(actor, input.role);
  await ensureEmailAvailable(input.email);
  const linkedProfessionalIds = input.role === "ADMIN" ? [] : await validateLinkedProfessionals(actor.organizationId, input.linkedProfessionalIds);
  const token = randomBytes(32).toString("base64url");
  const invitation = invitationDraft(actor, { ...input, linkedProfessionalIds }, token);
  const ref = db().doc(paths.document(actor.organizationId, "memberInvitations", invitation.id));
  const previous = await db().collection(paths.collection(actor.organizationId, "memberInvitations"))
    .where("email", "==", input.email).get();
  const batch = db().batch();
  for (const document of previous.docs.filter((item) => item.data().status === "PENDING")) {
    batch.update(document.ref, { status: "REVOKED", tokenHash: null, updatedAt: new Date(), updatedBy: actor.userId });
  }
  batch.create(ref, toStored("memberInvitations", invitation));
  await batch.commit();
  try {
    await deliverInvitation(invitation, token, actor.organization);
  } catch {
    await ref.update({ status: "DELIVERY_FAILED", updatedAt: new Date() });
    throw new HttpsError("unavailable", "O convite foi criado, mas o e-mail não saiu. Use reenviar depois de conferir o SES.");
  }
  return { invitationId: invitation.id, expiresAt: invitation.expiresAt };
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

export const inviteTeamMember = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "member:invite");
  await consumeRateLimit(actor.userId, "teamWrite");
  return await createAndSendInvitation(actor, parse(inviteSchema, request.data));
});

export const decideTeamRequest = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "member:invite");
  await consumeRateLimit(actor.userId, "teamWrite");
  const input = parse(decisionSchema, request.data);
  const ref = db().doc(paths.document(actor.organizationId, "memberRequests", input.requestId));
  const snapshot = await ref.get();
  const record = snapshot.data();
  if (!record || record.status !== "PENDING") throw new HttpsError("failed-precondition", "Esta solicitação já foi decidida.");
  if (input.decision === "REJECTED") {
    await ref.update({ status: "REJECTED", decidedBy: actor.userId, decisionReason: input.reason || null, updatedAt: new Date(), updatedBy: actor.userId });
    return { invitationId: null };
  }
  const result = await createAndSendInvitation(actor, record);
  await ref.update({ status: "APPROVED", decidedBy: actor.userId, decisionReason: input.reason || null, updatedAt: new Date(), updatedBy: actor.userId });
  return result;
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
    linkedProfessionalIds: invitation.linkedProfessionalIds ?? [], removedAt: null, ...stamp,
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

export const setTeamMemberStatus = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "member:update");
  await consumeRateLimit(actor.userId, "teamWrite");
  const input = parse(memberStatusSchema, request.data);
  if (input.memberId === actor.organization.ownerId) throw new HttpsError("failed-precondition", "O titular não pode ser suspenso.");
  const ref = db().doc(paths.document(actor.organizationId, "members", input.memberId));
  const target = (await ref.get()).data();
  if (!target || target.status === "REMOVED") throw new HttpsError("not-found", "Membro não encontrado.");
  authorizeRole(actor, target.role);
  await getAuth().updateUser(input.memberId, { disabled: input.status === "SUSPENDED" });
  if (input.status === "SUSPENDED") await getAuth().revokeRefreshTokens(input.memberId);
  await ref.update({ status: input.status, updatedAt: new Date(), updatedBy: actor.userId });
  return { ok: true };
});

export const removeTeamMember = onCall(OPTIONS, async (request) => {
  const actor = await tenantActor(request, "member:remove");
  await consumeRateLimit(actor.userId, "teamWrite");
  const { memberId } = parse(memberSchema, request.data);
  if (memberId === actor.organization.ownerId) throw new HttpsError("failed-precondition", "O titular é intransferível e não pode ser removido.");
  const membershipRef = db().doc(paths.document(actor.organizationId, "members", memberId));
  const membership = (await membershipRef.get()).data();
  if (!membership || membership.status === "REMOVED") throw new HttpsError("not-found", "Membro não encontrado.");
  authorizeRole(actor, membership.role);
  try { await getAuth().updateUser(memberId, { disabled: true }); await getAuth().revokeRefreshTokens(memberId); } catch (error) { if (error?.code !== "auth/user-not-found") throw error; }
  const removedAt = now();
  const pseudonym = `removido-${createHash("sha256").update(`${actor.organizationId}:${memberId}`).digest("hex").slice(0, 12)}`;
  const batch = db().batch();
  batch.update(membershipRef, { userId: null, status: "REMOVED", invitedBy: null, linkedProfessionalIds: [], removedAt: new Date(removedAt), updatedAt: new Date(removedAt), updatedBy: actor.userId });
  const professionalRef = db().doc(paths.document(actor.organizationId, "professionals", memberId));
  const professional = await professionalRef.get();
  if (professional.exists) batch.update(professionalRef, { userId: null, displayName: "Profissional removido", email: `${pseudonym}@removed.atendara.invalid`, phone: null, licenseNumber: null, specialties: [], avatarUrl: null, active: false, updatedAt: new Date(removedAt), updatedBy: actor.userId });
  batch.set(db().doc(paths.account(memberId)), { userId: memberId, email: `${pseudonym}@removed.atendara.invalid`, displayName: "Membro removido", status: "SUSPENDED", organizationId: actor.organizationId, platformRole: "PROFESSIONAL", professionId: actor.organization.primaryProfession, modules: [], subscriptionStatus: "CANCELLED", accessUntil: null, accessUntilMs: 0, mustChangePassword: false, origin: "INVITATION", createdAt: removedAt, removedAt }, { merge: true });
  const audit = tenantAudit({ organizationId: actor.organizationId, actorId: actor.userId, action: "PERMISSION_CHANGED", resourceType: "member", resourceId: memberId, summary: "Membro removido e cadastro pseudonimizado.", metadata: { previousRole: membership.role } });
  batch.create(db().doc(paths.document(actor.organizationId, "auditLogs", audit.id)), toStored("auditLogs", audit));
  await batch.commit();
  try { await getAuth().deleteUser(memberId); } catch (error) { if (error?.code !== "auth/user-not-found") throw error; }
  return { ok: true };
});
