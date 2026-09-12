import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

import { paths } from "./generated/paths.js";
import { APP_MODULES } from "./generated/access.js";
import { ACCOUNT_CALL_OPTIONS, initialCredential, masterOf, parse } from "./platform-auth.js";
import { auditEntry } from "./platform.js";

/**
 * Contas de administrador da plataforma.
 *
 * So a chave mestra (`platformMaster`) chama estas callables, com segundo
 * fator. A chave mestra nasce no bootstrap e nao e criada nem retirada por
 * aqui: nenhuma callable escreve `platformMaster`, nenhuma altera a propria
 * conta e nenhuma suspende outra chave mestra. Cada ato grava a propria entrada
 * em `platformAuditLogs` junto do ato.
 */

const db = () => getFirestore();

const adminRegistration = z.object({ displayName: z.string().trim().min(3).max(100), email: z.email().trim().toLowerCase() }).strict();
const statusChange = z.object({ userId: z.string().min(1).max(128), status: z.enum(["ACTIVE", "SUSPENDED"]) }).strict();

export const createPlatformAdmin = onCall(ACCOUNT_CALL_OPTIONS, async (request) => {
  await masterOf(request);
  const input = parse(adminRegistration, request.data);
  const { temporaryPassword, verifier } = initialCredential();
  let user;
  try {
    user = await getAuth().createUser({ email: input.email, displayName: input.displayName, password: temporaryPassword });
  } catch (error) {
    throw new HttpsError("already-exists", error?.code === "auth/email-already-exists" ? "Este e-mail já está cadastrado." : "Não foi possível criar a conta.");
  }

  const createdAt = new Date().toISOString();
  // Sem organizacao e sem validade: administrador nunca alcanca tenant. Nasce
  // sem chave mestra, com troca de senha e cadastro do segundo fator pendentes.
  const account = {
    userId: user.uid,
    email: input.email,
    displayName: input.displayName,
    platformRole: "PLATFORM_ADMIN",
    platformMaster: false,
    professionId: null,
    organizationId: null,
    modules: [...APP_MODULES],
    status: "ACTIVE",
    mustChangePassword: true,
    createdAt,
  };
  const entry = auditEntry({ action: "PLATFORM_ADMIN_CREATED", actorId: request.auth.uid, targetUserId: user.uid, createdAt });

  const batch = db().batch();
  batch.create(db().doc(paths.account(user.uid)), account);
  batch.create(db().doc(paths.initialPassword(user.uid)), verifier);
  batch.create(entry.ref, entry.data);
  try {
    await batch.commit();
  } catch {
    await getAuth().deleteUser(user.uid);
    throw new HttpsError("internal", "Não foi possível concluir o cadastro.");
  }
  return { userId: user.uid, temporaryPassword };
});

/**
 * Suspende ou reativa um administrador. Firestore primeiro — regras e callables
 * leem `status` e fecham na hora —, depois o Auth, que impede novo login e
 * derruba as sessoes abertas.
 */
export const setPlatformAdminStatus = onCall(ACCOUNT_CALL_OPTIONS, async (request) => {
  await masterOf(request);
  const { userId, status } = parse(statusChange, request.data);
  if (userId === request.auth.uid) {
    throw new HttpsError("failed-precondition", "A chave mestra não altera a própria conta por aqui.");
  }

  const ref = db().doc(paths.account(userId));
  const previous = await db().runTransaction(async (transaction) => {
    const account = (await transaction.get(ref)).data();
    if (!account || account.platformRole !== "PLATFORM_ADMIN") {
      throw new HttpsError("not-found", "Administrador não encontrado.");
    }
    if (account.platformMaster === true) {
      throw new HttpsError("permission-denied", "Chave mestra não é suspensa por esta callable.");
    }
    if (account.status === status) return account.status;

    const entry = auditEntry({
      action: status === "SUSPENDED" ? "PLATFORM_ADMIN_SUSPENDED" : "PLATFORM_ADMIN_REACTIVATED",
      actorId: request.auth.uid,
      targetUserId: userId,
      details: { status: { from: account.status, to: status } },
      createdAt: new Date().toISOString(),
    });
    transaction.update(ref, { status });
    transaction.create(entry.ref, entry.data);
    return account.status;
  });

  if (previous !== status) {
    await getAuth().updateUser(userId, { disabled: status === "SUSPENDED" });
    if (status === "SUSPENDED") await getAuth().revokeRefreshTokens(userId);
  }
  return { ok: true, status };
});
