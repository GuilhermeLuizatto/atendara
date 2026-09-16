import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

import { paths } from "./generated/paths.js";
import { auditEntry } from "./platform.js";
import { SELF_SERVICE_ACTOR } from "./generated/platform-config.js";
import { REGION } from "./platform-auth.js";

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
  { region: REGION, schedule: "0 4 * * *", timeZone: "America/Sao_Paulo", maxInstances: 1 },
  async () => {
    await closeExpiredTrials();
  },
);
