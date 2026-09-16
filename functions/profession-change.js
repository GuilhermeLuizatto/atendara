import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

import { paths } from "./generated/paths.js";
import { PROFESSION_IDS } from "./generated/profession.js";
import { getProfession } from "./generated/professions.js";
import { PROFESSION_CHANGE_REASON_LENGTH } from "./generated/platform-config.js";
import { ACCOUNT_CALL_OPTIONS, accountOf, adminOf, parse } from "./platform-auth.js";
import { auditEntry } from "./platform.js";
import { consumeRateLimit } from "./rate-limit.js";

/**
 * Troca de profissao: pedido do titular, decisao da operadora.
 *
 * A profissao nao e preferencia de interface. Ela decide o vocabulario, a
 * taxonomia das mensagens, os canais permitidos e o quanto um aviso pode
 * revelar. Trocar sozinho permitiria a um dentista virar medico, ou a um
 * psiquiatra virar psicologo, sem ninguem olhar — e os avisos daquela
 * organizacao passariam a falar como a nova profissao no dia seguinte.
 *
 * Por isso sao duas callables e um documento unico por organizacao
 * (`platformProfessionRequests/{organizationId}`): enquanto nao houver
 * aprovacao, a profissao nao muda, e cada ato deixa registro append-only.
 */

const db = () => getFirestore();

const reason = z
  .string()
  .trim()
  .min(PROFESSION_CHANGE_REASON_LENGTH.min)
  .max(PROFESSION_CHANGE_REASON_LENGTH.max);

const requestSchema = z.object({ professionId: z.enum(PROFESSION_IDS), reason }).strict();
const decisionSchema = z
  .object({
    organizationId: z.string().min(1).max(128),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason,
  })
  .strict();

/**
 * O titular da organizacao, conferido contra o banco. Nenhuma callable aceita
 * `organizationId` de quem pede: ele sai de `accounts/{uid}` no servidor.
 */
async function holderOf(request) {
  const account = await accountOf(request);
  if (account.platformRole !== "PROFESSIONAL" || account.mustChangePassword || !account.organizationId) {
    throw new HttpsError("permission-denied", "Somente o titular pede a troca de profissão.");
  }
  const organizationRef = db().doc(paths.organization(account.organizationId));
  const organization = (await organizationRef.get()).data();
  if (!organization) throw new HttpsError("not-found", "Organização não encontrada.");
  // O titular, e so ele: um OWNER promovido gerencia a organizacao, mas nao
  // redefine o que ela e — do mesmo modo que nao contrata a assinatura.
  if (organization.ownerId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Somente o titular pede a troca de profissão.");
  }
  return { account, organization, organizationRef };
}

export const requestProfessionChange = onCall(ACCOUNT_CALL_OPTIONS, async (request) => {
  const { account, organization } = await holderOf(request);
  await consumeRateLimit(request.auth.uid, "professionChangeRequest");
  const input = parse(requestSchema, request.data);

  const current = organization.primaryProfession ?? account.professionId;
  if (input.professionId === current) {
    throw new HttpsError("failed-precondition", "Esta já é a sua profissão.");
  }
  // Fora da vitrine nao se entra nem por troca: a lista da tela e conveniencia,
  // esta e a trava.
  if (!getProfession(input.professionId).listed) {
    throw new HttpsError("invalid-argument", "Escolha uma das profissões oferecidas.");
  }

  const organizationId = account.organizationId;
  const requestRef = db().doc(paths.platformProfessionRequest(organizationId));
  const createdAt = new Date().toISOString();

  await db().runTransaction(async (transaction) => {
    const existing = (await transaction.get(requestRef)).data();
    if (existing?.status === "PENDING") {
      throw new HttpsError("failed-precondition", "Você já tem um pedido aguardando resposta.");
    }

    const pedido = {
      organizationId,
      requestedBy: request.auth.uid,
      from: current,
      to: input.professionId,
      reason: input.reason.trim(),
      status: "PENDING",
      requestedAt: createdAt,
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
    };
    const entry = auditEntry({
      action: "PROFESSION_CHANGE_REQUESTED",
      actorId: request.auth.uid,
      organizationId,
      targetUserId: request.auth.uid,
      reason: pedido.reason,
      details: { from: pedido.from, to: pedido.to },
      createdAt,
    });

    transaction.set(requestRef, pedido);
    transaction.create(entry.ref, entry.data);
  });

  return { ok: true };
});

export const decideProfessionChange = onCall(ACCOUNT_CALL_OPTIONS, async (request) => {
  await adminOf(request);
  const input = parse(decisionSchema, request.data);

  const requestRef = db().doc(paths.platformProfessionRequest(input.organizationId));
  const organizationRef = db().doc(paths.organization(input.organizationId));
  const approved = input.decision === "APPROVED";

  await db().runTransaction(async (transaction) => {
    const pedido = (await transaction.get(requestRef)).data();
    if (!pedido || pedido.status !== "PENDING") {
      throw new HttpsError("failed-precondition", "Não há pedido aguardando resposta nesta organização.");
    }
    const organization = (await transaction.get(organizationRef)).data();
    if (!organization) throw new HttpsError("not-found", "Organização não encontrada.");

    const accountRef = db().doc(paths.account(pedido.requestedBy));
    const account = (await transaction.get(accountRef)).data();
    if (!account || account.organizationId !== input.organizationId) {
      throw new HttpsError("failed-precondition", "Quem pediu não responde mais por esta organização.");
    }
    const profileRef = db().doc(paths.document(input.organizationId, "professionals", pedido.requestedBy));
    const profile = (await transaction.get(profileRef)).data();

    const decidedAt = new Date().toISOString();
    const entry = auditEntry({
      action: approved ? "PROFESSION_CHANGE_APPROVED" : "PROFESSION_CHANGE_REJECTED",
      actorId: request.auth.uid,
      organizationId: input.organizationId,
      targetUserId: pedido.requestedBy,
      reason: input.reason.trim(),
      details: { from: pedido.from, to: pedido.to, requestedAt: pedido.requestedAt },
      createdAt: decidedAt,
    });

    transaction.update(requestRef, {
      status: approved ? "APPROVED" : "REJECTED",
      decidedAt,
      decidedBy: request.auth.uid,
      decisionReason: input.reason.trim(),
    });
    if (approved) {
      transaction.update(accountRef, { professionId: pedido.to });
      transaction.update(organizationRef, {
        primaryProfession: pedido.to,
        professions: [pedido.to],
        updatedAt: decidedAt,
        updatedBy: request.auth.uid,
      });
      // O registro no conselho anterior nao vale para a profissao nova, e
      // mante-lo seria afirmar uma habilitacao que ninguem conferiu. Some; a
      // pessoa informa o novo no proprio perfil.
      if (profile) {
        transaction.update(profileRef, {
          profession: pedido.to,
          licenseNumber: null,
          updatedAt: decidedAt,
          updatedBy: request.auth.uid,
        });
      }
    }
    transaction.create(entry.ref, entry.data);
  });

  return { ok: true };
});
