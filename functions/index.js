import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { paths } from "./generated/paths.js";
import { APP_MODULES } from "./generated/access.js";
import { PROFESSION_IDS } from "./generated/profession.js";

initializeApp();
const options = { region: "southamerica-east1", maxInstances: 2, cors: true };
const db = getFirestore();
const modules = z.array(z.enum(APP_MODULES)).min(1).max(APP_MODULES.length);
const registration = z.object({ displayName: z.string().trim().min(3).max(100), email: z.email().trim().toLowerCase(), professionId: z.enum(PROFESSION_IDS), modules, accessUntil: z.iso.datetime() }).strict();
const changes = z.object({ userId: z.string().min(1).max(128), status: z.enum(["ACTIVE", "SUSPENDED"]), subscriptionStatus: z.enum(["ACTIVE", "PENDING", "CANCELLED"]), accessUntil: z.iso.datetime().nullable(), modules }).strict();
function parse(schema, data) { const result = schema.safeParse(data); if (!result.success) throw new HttpsError("invalid-argument", "Confira os dados informados."); return result.data; }
async function accountOf(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Entre na sua conta.");
  const account = (await db.doc(paths.account(request.auth.uid)).get()).data();
  if (!account || account.status !== "ACTIVE") throw new HttpsError("permission-denied", "Cadastro nao liberado.");
  return account;
}
async function adminOf(request) {
  const account = await accountOf(request);
  if (account.platformRole !== "PLATFORM_ADMIN" || account.mustChangePassword) throw new HttpsError("permission-denied", "Apenas o administrador pode gerenciar acessos.");
  return account;
}
export const registerProfessional = onCall(options, async request => {
  await adminOf(request);
  const input = parse(registration, request.data);
  if (Date.parse(input.accessUntil) <= Date.now()) throw new HttpsError("invalid-argument", "Defina uma validade futura.");
  const temporaryPassword = `At!${randomBytes(24).toString("base64url")}`;
  const salt = randomBytes(16).toString("hex");
  let user;
  try { user = await getAuth().createUser({ email: input.email, displayName: input.displayName, password: temporaryPassword }); }
  catch (error) { throw new HttpsError("already-exists", error.code === "auth/email-already-exists" ? "Este e-mail ja esta cadastrado." : "Nao foi possivel criar a conta."); }
  const organizationId = randomUUID();
  const account = { ...input, accessUntilMs: Date.parse(input.accessUntil), userId: user.uid, organizationId, platformRole: "PROFESSIONAL", status: "ACTIVE", subscriptionStatus: "ACTIVE", mustChangePassword: true, createdAt: new Date().toISOString() };
  const batch = db.batch();
  const stamp = { createdAt: account.createdAt, updatedAt: account.createdAt, createdBy: request.auth.uid, updatedBy: request.auth.uid };
  batch.create(db.doc(paths.account(user.uid)), account);
  batch.create(db.doc(paths.initialPassword(user.uid)), { salt, hash: scryptSync(temporaryPassword, salt, 32).toString("hex") });
  batch.create(db.doc(paths.organization(organizationId)), { id: organizationId, name: input.displayName, slug: organizationId, primaryProfession: input.professionId, professions: [input.professionId], ownerId: user.uid, ...stamp });
  batch.create(db.doc(paths.document(organizationId, "members", user.uid)), { id: user.uid, userId: user.uid, organizationId, role: "PROFESSIONAL", status: "ACTIVE", invitedBy: request.auth.uid, ...stamp });
  // Sem perfil profissional a organizacao nasce sem quem atenda: a agenda
  // recusaria o primeiro atendimento. O cliente nao pode cria-lo (as regras
  // exigem papel administrativo), entao ele nasce aqui, junto do resto.
  batch.create(db.doc(paths.document(organizationId, "professionals", user.uid)), { id: user.uid, organizationId, userId: user.uid, displayName: input.displayName, email: input.email, phone: null, profession: input.professionId, licenseNumber: null, specialties: [], avatarUrl: null, active: true, ...stamp });
  try { await batch.commit(); } catch { await getAuth().deleteUser(user.uid); throw new HttpsError("internal", "Nao foi possivel concluir o cadastro."); }
  return { userId: user.uid, temporaryPassword };
});
export const updateAccount = onCall(options, async request => {
  await adminOf(request);
  const { userId, ...input } = parse(changes, request.data);
  const ref = db.doc(paths.account(userId));
  await db.runTransaction(async transaction => {
    const account = (await transaction.get(ref)).data();
    if (!account || account.platformRole !== "PROFESSIONAL") throw new HttpsError("permission-denied", "Somente cadastros profissionais podem ser alterados.");
    transaction.update(ref, { ...input, accessUntilMs: input.accessUntil ? Date.parse(input.accessUntil) : 0 });
  });
  return { ok: true };
});
export const completeInitialPassword = onCall(options, async request => {
  const account = await accountOf(request);
  if (!account.mustChangePassword) throw new HttpsError("failed-precondition", "A senha inicial ja foi substituida.");
  if (Date.now() / 1000 - request.auth.token.auth_time > 300) throw new HttpsError("unauthenticated", "Entre novamente para alterar sua senha.");
  const { password } = parse(z.object({ password: z.string().min(12).max(128) }).strict(), request.data);
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
