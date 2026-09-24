import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { fromStored, toStored } from "./firestore-dates.js";
import { hasActiveAccess } from "./generated/access-policy.js";
import { paths } from "./generated/paths.js";
import { permissionsForMembership } from "./generated/permissions.js";

export const calendarRef = (context, collection = "calendarConnections") =>
  getFirestore().doc(
    paths.document(context.organizationId, collection, context.professionalId),
  );

export function calendarData(snapshot, collection = "calendarConnections") {
  return snapshot.exists
    ? fromStored(collection, snapshot.id, snapshot.data())
    : null;
}

/**
 * Quem é dono da conexão ainda pode usá-la? Lido na transação de quem chama.
 * `disconnect` só exige o vínculo: desconectar continua permitido depois do
 * vencimento da assinatura.
 */
export async function calendarOwnerAllowed(transaction, context, { disconnect = false } = {}) {
  const db = getFirestore();
  const account = (
    await transaction.get(db.doc(paths.account(context.userId)))
  ).data();
  const organization = (
    await transaction.get(db.doc(paths.organization(context.organizationId)))
  ).data();
  const member = (
    await transaction.get(
      db.doc(paths.document(context.organizationId, "members", context.userId)),
    )
  ).data();
  const professional = (
    await transaction.get(
      db.doc(
        paths.document(
          context.organizationId,
          "professionals",
          context.professionalId,
        ),
      ),
    )
  ).data();
  const owns =
    account?.organizationId === context.organizationId &&
    account?.platformRole === "PROFESSIONAL" &&
    !!organization &&
    member?.status === "ACTIVE" &&
    professional?.userId === context.userId;
  return (
    owns &&
    (disconnect ||
      (hasActiveAccess(account) &&
        !!account.modules?.includes("agenda") &&
        !!professional.active &&
        permissionsForMembership(member.role, organization.ownerId === context.userId).includes(
          "appointment:read",
        )))
  );
}

/** Revalida dentro da transação: perder o vínculo durante o OAuth invalida a volta. */
export async function checkCalendarOwner(transaction, context, options = {}) {
  if (!(await calendarOwnerAllowed(transaction, context, options))) {
    throw new HttpsError(
      "permission-denied",
      "Conecte somente a sua agenda, com acesso ativo ao Atendara.",
    );
  }
}

export async function calendarTransaction(context, action, options) {
  return getFirestore().runTransaction(async (transaction) => {
    await checkCalendarOwner(transaction, context, options);
    const ref = calendarRef(context);
    const connection = calendarData(await transaction.get(ref));
    return action(transaction, ref, connection);
  });
}

export function writeConnection(transaction, ref, context, connection, patch) {
  const now = new Date().toISOString();
  transaction.set(
    ref,
    toStored("calendarConnections", {
      id: context.professionalId,
      organizationId: context.organizationId,
      professionalId: context.professionalId,
      provider: "GOOGLE",
      status: "REVOKED",
      createdAt: now,
      createdBy: context.userId,
      ...connection,
      ...patch,
      updatedAt: now,
      updatedBy: context.userId,
    }),
  );
}
