import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { paths } from "./generated/paths.js";
import { APP_MODULES } from "./generated/access.js";
import { PROFESSION_IDS } from "./generated/profession.js";
import { resolveAccountGate } from "./generated/access-gate.js";
import { ACCOUNT_CALL_OPTIONS, accountOf, adminOf, initialCredential, parse } from "./platform-auth.js";
import { assertGrantWindow, auditEntry, gateFields, grantDocument, initialGrantSchema } from "./platform.js";
import { runAs } from "./service-accounts.js";
import { seedServices } from "./service-seeds.js";
import { passwordPolicyError } from "./generated/password-policy.js";
import { PASSWORD_LENGTH } from "./generated/platform-config.js";

initializeApp();
const db = getFirestore();
const modules = z.array(z.enum(APP_MODULES)).min(1).max(APP_MODULES.length);
// Sem `subscriptionStatus` nem `accessUntil`: validade so nasce do webhook ou de
// concessao registrada (regra 10 do AGENTS.md). `strict` recusa os dois campos.
const registration = z.object({ displayName: z.string().trim().min(3).max(100), email: z.email().trim().toLowerCase(), professionId: z.enum(PROFESSION_IDS), modules, initialGrant: initialGrantSchema.optional() }).strict();
const changes = z.object({ userId: z.string().min(1).max(128), status: z.enum(["ACTIVE", "SUSPENDED"]), modules }).strict();
// Conta propria (H.3): criar e trocar senha de conta pede Authentication, e so.
const CONTAS_CALL_OPTIONS = { ...ACCOUNT_CALL_OPTIONS, ...runAs("contas") };
export const registerProfessional = onCall(CONTAS_CALL_OPTIONS, async request => {
  await adminOf(request);
  const { initialGrant, ...input } = parse(registration, request.data);
  const nowMs = Date.now();
  if (initialGrant) assertGrantWindow(initialGrant.until, nowMs);
  const { temporaryPassword, verifier } = initialCredential();
  let user;
  try { user = await getAuth().createUser({ email: input.email, displayName: input.displayName, password: temporaryPassword }); }
  catch (error) { throw new HttpsError("already-exists", error.code === "auth/email-already-exists" ? "Este e-mail já está cadastrado." : "Não foi possível criar a conta."); }
  const organizationId = randomUUID();
  const createdAt = new Date(nowMs).toISOString();
  // A conta nasce pendente e sem validade. A concessao inicial, quando pedida,
  // segue o mesmo caminho e o mesmo registro de uma concessao posterior.
  const grant = initialGrant ? grantDocument({ organizationId, subscriberUserId: user.uid, input: initialGrant, actorId: request.auth.uid, stamp: createdAt }) : null;
  const gate = resolveAccountGate({ subscription: null, grant, nowMs });
  const account = { ...input, userId: user.uid, organizationId, platformRole: "PROFESSIONAL", status: "ACTIVE", ...gateFields(gate), mustChangePassword: true, createdAt };
  const batch = db.batch();
  const stamp = { createdAt, updatedAt: createdAt, createdBy: request.auth.uid, updatedBy: request.auth.uid };
  batch.create(db.doc(paths.account(user.uid)), account);
  batch.create(db.doc(paths.initialPassword(user.uid)), verifier);
  batch.create(db.doc(paths.organization(organizationId)), { id: organizationId, name: input.displayName, slug: organizationId, primaryProfession: input.professionId, professions: [input.professionId], ownerId: user.uid, ...stamp });
  batch.create(db.doc(paths.document(organizationId, "members", user.uid)), { id: user.uid, userId: user.uid, organizationId, role: "PROFESSIONAL", status: "ACTIVE", invitedBy: request.auth.uid, ...stamp });
  // Sem perfil profissional a organizacao nasce sem quem atenda: a agenda
  // recusaria o primeiro atendimento. O cliente nao pode cria-lo (as regras
  // exigem papel administrativo), entao ele nasce aqui, junto do resto.
  batch.create(db.doc(paths.document(organizationId, "professionals", user.uid)), { id: user.uid, organizationId, userId: user.uid, displayName: input.displayName, email: input.email, phone: null, profession: input.professionId, licenseNumber: null, specialties: [], avatarUrl: null, active: true, ...stamp });
  seedServices(batch, { db, organizationId, professionId: input.professionId, stamp });
  const registered = auditEntry({ action: "ACCOUNT_REGISTERED", actorId: request.auth.uid, organizationId, targetUserId: user.uid, details: { professionId: input.professionId, modules: input.modules, initialGrant: grant ? { kind: grant.kind, until: grant.until } : null }, createdAt });
  batch.create(registered.ref, registered.data);
  if (grant) {
    const granted = auditEntry({ action: "ACCESS_GRANTED", actorId: request.auth.uid, organizationId, targetUserId: user.uid, reason: grant.reason, details: { kind: grant.kind, until: grant.until, replacedUntil: null, resultingAccessUntil: gate.accessUntil }, createdAt });
    batch.create(db.doc(paths.platformAccessGrant(organizationId)), grant);
    batch.create(granted.ref, granted.data);
  }
  try { await batch.commit(); } catch { await getAuth().deleteUser(user.uid); throw new HttpsError("internal", "Não foi possível concluir o cadastro."); }
  return { userId: user.uid, temporaryPassword };
});
export const updateAccount = onCall(CONTAS_CALL_OPTIONS, async request => {
  await adminOf(request);
  const { userId, ...input } = parse(changes, request.data);
  const ref = db.doc(paths.account(userId));
  const previous = await db.runTransaction(async transaction => {
    const account = (await transaction.get(ref)).data();
    if (!account || account.platformRole !== "PROFESSIONAL") throw new HttpsError("permission-denied", "Somente cadastros profissionais podem ser alterados.");
    const createdAt = new Date().toISOString();
    const entry = auditEntry({ action: "ACCOUNT_UPDATED", actorId: request.auth.uid, organizationId: account.organizationId ?? null, targetUserId: userId, details: { status: { from: account.status, to: input.status }, modules: { from: account.modules ?? [], to: input.modules } }, createdAt });
    transaction.update(ref, input);
    transaction.create(entry.ref, entry.data);
    return account.status;
  });
  // As regras ja fecham o painel pela situacao da conta; isto fecha o login. Num
  // incidente, suspender tem de derrubar tambem a sessao aberta, e nao so a
  // proxima leitura — o mesmo que `setPlatformAdminStatus` faz com administrador.
  if (previous !== input.status) {
    await getAuth().updateUser(userId, { disabled: input.status === "SUSPENDED" });
    if (input.status === "SUSPENDED") await getAuth().revokeRefreshTokens(userId);
  }
  return { ok: true };
});
export const completeInitialPassword = onCall(CONTAS_CALL_OPTIONS, async request => {
  const account = await accountOf(request);
  if (!account.mustChangePassword) throw new HttpsError("failed-precondition", "A senha inicial já foi substituída.");
  if (Date.now() / 1000 - request.auth.token.auth_time > 300) throw new HttpsError("unauthenticated", "Entre novamente para alterar sua senha.");
  const { password } = parse(z.object({ password: z.string().min(1).max(PASSWORD_LENGTH.max) }).strict(), request.data);
  // Quem grava e o SDK de administrador, que nao passa pela politica de senha
  // do Identity Platform: sem esta trava, uma senha fora dela seria aceita aqui
  // e recusada no login seguinte.
  const weak = passwordPolicyError(password);
  if (weak) throw new HttpsError("invalid-argument", weak);
  const verifierRef = db.doc(paths.initialPassword(request.auth.uid));
  const verifier = (await verifierRef.get()).data();
  if (!verifier) throw new HttpsError("failed-precondition", "Solicite ao administrador uma nova senha inicial.");
  if (timingSafeEqual(scryptSync(password, verifier.salt, 32), Buffer.from(verifier.hash, "hex"))) throw new HttpsError("invalid-argument", "Escolha uma senha diferente da inicial.");
  await getAuth().updateUser(request.auth.uid, { password });
  // A liberacao so ocorre depois que o Auth aceitou a nova senha.
  const batch = db.batch();
  batch.update(db.doc(paths.account(request.auth.uid)), { mustChangePassword: false });
  batch.delete(verifierRef);
  await batch.commit();
  return { ok: true };
});

// Concessao manual e revogacao: atos da operadora, com registro.
export { grantAccess, revokeAccess } from "./platform.js";

// Cadastro aberto: a pessoa cria a propria conta e o teste de 14 dias comeca
// quando ela confirma o e-mail. Concessao registrada, como as da operadora.
export { registerSelfService, activateTrial } from "./self-service.js";

// Fim do teste: rotina diaria que registra o vencimento e abre o prazo de
// retencao. Nao fecha o painel — quem fecha e a data, nas regras e na interface.
export { closeExpiredTrialsDaily, eraseAbandonedTrialsDaily } from "./trial.js";
export { eraseUnconfirmedSignupsDaily } from "./signup-cleanup.js";

// Troca de profissao: o titular pede, a operadora decide. Enquanto nao houver
// aprovacao, a profissao nao muda.
export { requestProfessionChange, decideProfessionChange } from "./profession-change.js";

// Administradores da plataforma: so a chave mestra cria, suspende e reativa.
export { createPlatformAdmin, setPlatformAdminStatus } from "./platform-admins.js";

// Direitos do titular dos dados: exportacao e eliminacao, so pelo backend.
export {
  exportClientData,
  eraseClientData,
  startOrganizationExport,
  exportOrganizationPage,
  deleteOrganization,
} from "./privacy.js";

// Fila de automacao: o gatilho da agenda planeja os avisos e o despachante os
// executa no horario, conferindo as travas de novo. O navegador so le a fila.
export { planAppointmentNotices, planCalendarEvents, dispatchAutomationTask } from "./automation.js";
export { automationCallback } from "./automation-callback.js";
export { expireAutomationTasksEveryFiveMinutes } from "./automation-expiry.js";
export { registerMessagingSender } from "./messaging-senders.js";
export { completeWhatsappEmbeddedSignup } from "./whatsapp-signup.js";
export { inboundWebhook } from "./inbound.js";
export { previewAI } from "./ai-preview.js";
export {
  startCalendarConnection,
  googleOAuthCallback,
  disconnectCalendar,
  calendarBusyCallback,
  getCalendarConnection,
  refreshCalendarBusy,
  cleanupDeletedCalendarConnection,
  refreshCalendarBusyEvery30Minutes,
} from "./calendar.js";
export {
  setOrganizationAutomationSwitch,
  setGlobalAutomationSwitch,
  retryAutomationTask,
} from "./automation-control.js";

// Cobranca da plataforma. Vive em billing.js porque e outro assunto: aqui
// estao contas e acesso; la esta a mensalidade que a operadora cobra.
export {
  createSubscriptionCheckout,
  openBillingPortal,
  cancelPlatformSubscription,
  stripeWebhook,
} from "./billing.js";
