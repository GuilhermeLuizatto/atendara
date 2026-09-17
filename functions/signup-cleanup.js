import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

import { paths } from "./generated/paths.js";
import { SELF_SERVICE_ACTOR, UNCONFIRMED_SIGNUP_RETENTION_DAYS } from "./generated/platform-config.js";
import { REGION } from "./platform-auth.js";
import { auditEntry } from "./platform.js";
import { eraseOrganization } from "./privacy.js";
import { runAs } from "./service-accounts.js";

/**
 * A.8: nenhum login que nunca virou cadastro confirmado sobrevive sete dias.
 *
 * Sao dois jeitos de desistir no meio, e cada um deixa uma coisa diferente:
 *
 * - **Entrada pelo Google parada antes da segunda tela** (`/cadastro`, "Falta
 *   pouco"): so existe o login no Authentication. Nao ha conta, organizacao nem
 *   dado nenhum; sai o login.
 * - **Cadastro por senha sem o e-mail confirmado**: o `registerSelfService` ja
 *   criou conta, organizacao, membro e perfil profissional, e o teste nunca
 *   comecou. Sai tudo, pelo MESMO `eraseOrganization` da exclusao pedida pelo
 *   titular e da A.5 — nao existe um segundo caminho de apagamento.
 *
 * Irreversivel, entao o filtro e estreito. Nunca entra: conta criada pela
 * operadora (sem `origin: "SELF_SERVICE"`), quem confirmou o e-mail, quem ja
 * teve validade, quem ja assinou, e organizacao com concessao ou assinatura
 * registrada.
 */

const db = () => getFirestore();

const DAY_MS = 86_400_000;

/**
 * Teto por execucao, somando os dois casos. Cada cadastro por senha custa uma
 * varredura da organizacao (vazia, mas varredura); uma rodada que parou no teto
 * continua no dia seguinte.
 */
export const CLEANUP_BATCH = 25;

/** Pagina da listagem do Authentication; 1000 e o maximo que a API aceita. */
const LIST_PAGE = 1000;

function olderThanRetention(user, nowMs) {
  const created = Date.parse(user.metadata?.creationTime ?? "");
  return Number.isFinite(created) && created <= nowMs - UNCONFIRMED_SIGNUP_RETENTION_DAYS * DAY_MS;
}

/** Cadastro aberto por senha que parou antes da confirmacao, e so ele. */
function isUnconfirmedSignup(account, user) {
  return (
    account.origin === "SELF_SERVICE" &&
    account.platformRole === "PROFESSIONAL" &&
    user.emailVerified !== true &&
    Boolean(account.organizationId) &&
    !account.accessUntil &&
    !account.subscribedAt
  );
}

async function removeOrphanLogin(userId) {
  try {
    await getAuth().deleteUser(userId);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
  }
  // Depois de apagar: registro de algo que nao aconteceu seria pior que a falta
  // dele. O id do login nao identifica ninguem sem o login.
  const entry = auditEntry({
    action: "ORPHAN_LOGIN_REMOVED",
    actorId: SELF_SERVICE_ACTOR,
    targetUserId: userId,
    details: { retentionDays: UNCONFIRMED_SIGNUP_RETENTION_DAYS },
    createdAt: new Date().toISOString(),
  });
  const batch = db().batch();
  batch.create(entry.ref, entry.data);
  await batch.commit();
}

async function eraseUnconfirmedSignup(account, userId) {
  const organizationId = account.organizationId;
  // Concessao registrada quer dizer que o teste comecou: nao e mais cadastro
  // parado antes da confirmacao.
  const grant = (await db().doc(paths.platformAccessGrant(organizationId)).get()).data();
  if (grant) return false;

  const organizationRef = db().doc(paths.organization(organizationId));
  const organization = (await organizationRef.get()).data();
  if (!organization || organization.deletion?.status === "DONE") return false;

  const subscriptionRef = db().doc(paths.platformSubscription(organizationId));
  const subscription = (await subscriptionRef.get()).data();
  if (subscription) return false;

  await eraseOrganization({
    organizationId,
    organization,
    organizationRef,
    subscription: null,
    subscriptionRef,
    actorId: SELF_SERVICE_ACTOR,
    action: "UNCONFIRMED_SIGNUP_ERASED",
    lastAccountUserId: userId,
  });
  return true;
}

export async function eraseUnconfirmedSignups(nowMs = Date.now()) {
  let orphans = 0;
  let erased = 0;
  let pageToken;

  do {
    const page = await getAuth().listUsers(LIST_PAGE, pageToken);
    for (const user of page.users) {
      if (orphans + erased >= CLEANUP_BATCH) break;
      if (!olderThanRetention(user, nowMs)) continue;

      try {
        const account = (await db().doc(paths.account(user.uid)).get()).data();
        if (!account) {
          await removeOrphanLogin(user.uid);
          orphans += 1;
        } else if (isUnconfirmedSignup(account, user) && (await eraseUnconfirmedSignup(account, user.uid))) {
          erased += 1;
        }
      } catch (error) {
        // Um login que falhou nao pode impedir os outros; a rodada de amanha tenta
        // de novo. Sem e-mail no log: o id basta para achar no console.
        logger.error("Falha na limpeza de cadastro nao confirmado", { userId: user.uid, erro: String(error) });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken && orphans + erased < CLEANUP_BATCH);

  if (orphans || erased) logger.info("Cadastros nao confirmados limpos", { logins: orphans, cadastros: erased });
  return { orphans, erased };
}

/**
 * Quinze minutos depois do apagamento da A.5, que pode usar a janela inteira.
 * O horario nao e critico: sete dias nao viram oito por causa de uma rodada.
 */
export const eraseUnconfirmedSignupsDaily = onSchedule(
  { region: REGION, schedule: "45 4 * * *", timeZone: "America/Sao_Paulo", maxInstances: 1, timeoutSeconds: 540, ...runAs("privacidade") },
  async () => {
    await eraseUnconfirmedSignups();
  },
);
