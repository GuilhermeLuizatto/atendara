import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

import { paths } from "./generated/paths.js";
import { auditEntry } from "./platform.js";
import { eraseOrganization } from "./privacy.js";
import { BLOCKED_RETENTION_DAYS, SELF_SERVICE_ACTOR } from "./generated/platform-config.js";
import { REGION } from "./platform-auth.js";
import { runAs } from "./service-accounts.js";

/**
 * O fim do teste de 14 dias.
 *
 * O painel ja fecha sozinho na data: as Security Rules comparam
 * `accessUntilMs` com a hora do pedido, e `hasActiveAccess` faz o mesmo na
 * interface. Esta rotina NAO fecha nada — ela REGISTRA que o prazo chegou e
 * marca o inicio da retencao de 30 dias, que e o relogio da A.5.
 *
 * Por isso ela nao escreve `subscriptionStatus` nem `accessUntil`: seria um
 * quarto caminho de validade, e a regra 10 existe para nao haver um. O que a
 * conta ganha e `blockedSince`, que nao abre nem fecha nada.
 */

const db = () => getFirestore();

/** Teto por execucao. Uma rodada que nao terminou continua na do dia seguinte. */
const BATCH = 200;

/**
 * Teto do apagamento. Muito menor porque cada organizacao custa uma varredura
 * inteira: e melhor limpar cinco por dia com folga do que estourar o tempo da
 * funcao no meio de uma e deixar metade pseudonimizada.
 */
const ERASE_BATCH = 5;

const DAY_MS = 86_400_000;

export async function closeExpiredTrials(nowMs = Date.now()) {
  const vencidas = await db()
    .collection(paths.accounts())
    .where("origin", "==", "SELF_SERVICE")
    .where("blockedSince", "==", null)
    .where("accessUntilMs", ">", 0)
    .where("accessUntilMs", "<=", nowMs)
    .limit(BATCH)
    .get();

  if (vencidas.empty) return { closed: 0 };

  const stamp = new Date(nowMs).toISOString();
  const batch = db().batch();
  for (const account of vencidas.docs) {
    const data = account.data();
    batch.update(account.ref, { blockedSince: stamp });
    const entry = auditEntry({
      action: "TRIAL_ENDED",
      actorId: SELF_SERVICE_ACTOR,
      organizationId: data.organizationId ?? null,
      targetUserId: data.userId ?? account.id,
      // Nome proprio, e nao `accessUntil`: este registro conta que a validade
      // CHEGOU, nao que alguem a escreveu. A trava que varre o backend atras de
      // quem escreve validade precisa continuar apontando so tres arquivos.
      details: { expiredAt: data.accessUntil ?? null },
      createdAt: stamp,
    });
    batch.create(entry.ref, entry.data);
  }
  await batch.commit();

  logger.info("Testes encerrados", { quantidade: vencidas.size });
  return { closed: vencidas.size };
}

/**
 * Uma vez por dia, de madrugada em Sao Paulo. O horario nao e critico: quem
 * venceu ja perdeu o painel na hora exata, e esta rotina so alcanca o registro.
 */
export const closeExpiredTrialsDaily = onSchedule(
  { region: REGION, schedule: "0 4 * * *", timeZone: "America/Sao_Paulo", maxInstances: 1, ...runAs("privacidade") },
  async () => {
    await closeExpiredTrials();
  },
);

/**
 * Trinta dias depois do bloqueio: a organizacao abandonada deixa de
 * identificar alguem.
 *
 * Chama o MESMO apagamento que o titular pede quando encerra a organizacao
 * (`eraseOrganization`). Nao ha um segundo caminho de pseudonimizacao, e e
 * isso que sustenta a decisao D25: o resultado precisa impedir a
 * reidentificacao, e quem prova isso e a suite de acesso, que varre o que
 * sobrou atras dos nomes originais.
 *
 * Irreversivel. Por isso o filtro e estreito: so cadastro aberto, so depois do
 * prazo inteiro, e so sem assinatura viva.
 */
export async function eraseAbandonedTrials(nowMs = Date.now()) {
  const limite = new Date(nowMs - BLOCKED_RETENTION_DAYS * DAY_MS).toISOString();
  const abandonadas = await db()
    .collection(paths.accounts())
    .where("origin", "==", "SELF_SERVICE")
    // `>= ""` tira quem ainda nao foi bloqueada: no Firestore, `null` vem antes
    // de qualquer texto, e sem esta linha as contas vigentes entrariam.
    .where("blockedSince", ">=", "")
    .where("blockedSince", "<=", limite)
    .limit(ERASE_BATCH)
    .get();

  let erased = 0;
  for (const account of abandonadas.docs) {
    const data = account.data();
    const organizationId = data.organizationId;
    if (!organizationId) continue;

    const organizationRef = db().doc(paths.organization(organizationId));
    const organization = (await organizationRef.get()).data();
    if (!organization || organization.deletion?.status === "DONE") continue;

    const subscriptionRef = db().doc(paths.platformSubscription(organizationId));
    const subscription = (await subscriptionRef.get()).data();
    // Assinatura viva significa que alguem voltou a pagar entre o bloqueio e
    // hoje. Apagar seria destruir o que acabou de ser retomado.
    if (subscription && subscription.status !== "CANCELED") continue;

    try {
      await eraseOrganization({
        organizationId,
        organization,
        organizationRef,
        subscription,
        subscriptionRef,
        actorId: SELF_SERVICE_ACTOR,
        action: "ABANDONED_ORGANIZATION_ERASED",
        lastAccountUserId: data.userId ?? account.id,
      });
      erased += 1;
    } catch (error) {
      // Uma organizacao que falhou nao pode impedir as outras. A marca de
      // `IN_PROGRESS` ja ficou, e a rodada de amanha retoma com o mesmo id.
      logger.error("Falha ao apagar organizacao abandonada", { organizationId, erro: String(error) });
    }
  }

  if (erased) logger.info("Organizacoes abandonadas apagadas", { quantidade: erased });
  return { erased };
}

/**
 * Meia hora depois da rotina que encerra. Separada de proposito: encerrar e
 * barato e nunca falha; apagar e caro, e uma falha aqui nao pode impedir que
 * os testes do dia sejam dados por encerrados.
 */
export const eraseAbandonedTrialsDaily = onSchedule(
  { region: REGION, schedule: "30 4 * * *", timeZone: "America/Sao_Paulo", maxInstances: 1, timeoutSeconds: 540, ...runAs("privacidade") },
  async () => {
    await eraseAbandonedTrials();
  },
);
