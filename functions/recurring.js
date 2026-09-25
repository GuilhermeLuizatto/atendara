import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

import { currentMonthLaunch } from "./generated/finance-recurring.js";
import { paths } from "./generated/paths.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { REGION } from "./platform-auth.js";
import { runAs } from "./service-accounts.js";

/**
 * Mensalidades (cobrador dos clientes, C1): lanca o mes corrente de cada
 * mensalidade ativa.
 *
 * O painel ja lanca o mes quando a mensalidade nasce ou volta a valer; esta
 * rotina cobre a virada do mes. A decisao e a mesma dos dois lados
 * (`currentMonthLaunch`): so mes posterior ao `lastLaunchedPeriod`, e o mes
 * sai no MESMO lote que avanca o marcador. `create` no lancamento faz a
 * rotina nunca sobrescrever um mes existente — se o id ja existe, o lote
 * inteiro falha e nada muda.
 *
 * Nenhum aviso sai daqui: lembrete ao cliente e outra decisao (regra 11), e o
 * pelo WhatsApp esta em espera.
 */

const db = () => getFirestore();

/** Paginas da consulta; a rotina segue ate acabar, sem teto de execucao. */
const PAGE = 300;

export const LAUNCH_ACTOR = "Rotina de mensalidades do Atendara";

export async function launchRecurringCharges(now = new Date()) {
  const nowIso = now.toISOString();
  const totals = { launched: 0, skipped: 0, existing: 0, failed: 0 };
  let cursor = null;

  for (;;) {
    let query = db().collectionGroup("recurringCharges").where("status", "==", "ACTIVE").limit(PAGE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;

    for (const document of page.docs) {
      const organizationId = document.ref.parent.parent?.id;
      const charge = fromStored("recurringCharges", document.id, document.data());
      // O caminho diz a organizacao; o campo tem de concordar. Divergencia e
      // documento adulterado ou fora do lugar — nao se cobra ninguem com ele.
      if (!organizationId || charge.organizationId !== organizationId) {
        totals.failed++;
        logger.warn("recurring.mismatch", { path: document.ref.path });
        continue;
      }
      const launched = currentMonthLaunch(charge, { now: nowIso, userId: null });
      if (!launched) {
        totals.skipped++;
        continue;
      }

      const batch = db().batch();
      batch.create(db().doc(paths.document(organizationId, "transactions", launched.id)), toStored("transactions", launched));
      batch.update(document.ref, toStored("recurringCharges", { lastLaunchedPeriod: launched.period, updatedAt: nowIso, updatedBy: null }));
      const auditId = `${launched.id}-lancamento`;
      batch.create(
        db().doc(paths.document(organizationId, "auditLogs", auditId)),
        toStored("auditLogs", {
          id: auditId,
          organizationId,
          actorType: "SYSTEM",
          actorId: null,
          actorName: LAUNCH_ACTOR,
          action: "CREATE",
          resource: { type: "transaction", id: launched.id },
          summary: `Mês ${launched.period} lançado pela mensalidade.`,
          metadata: { recurringChargeId: charge.id, period: launched.period, amountInCents: launched.amountInCents },
          occurredAt: nowIso,
          createdAt: nowIso,
          createdBy: null,
          updatedAt: nowIso,
          updatedBy: null,
        }),
      );
      try {
        await batch.commit();
        totals.launched++;
      } catch (error) {
        // 6 = ALREADY_EXISTS: o painel ou uma rodada anterior lancou antes.
        if (error?.code === 6 || error?.code === "already-exists") totals.existing++;
        else {
          totals.failed++;
          logger.error("recurring.launch_failed", { path: document.ref.path, code: error?.code ?? null });
        }
      }
    }
    cursor = page.docs[page.docs.length - 1];
  }

  logger.info("recurring.launch", totals);
  return totals;
}

/**
 * Todo dia de madrugada em Sao Paulo. Diaria, e nao so no dia 1: se uma rodada
 * falhar, a do dia seguinte lanca o mes que faltou.
 */
export const launchRecurringChargesDaily = onSchedule(
  { region: REGION, schedule: "15 3 * * *", timeZone: "America/Sao_Paulo", maxInstances: 1, ...runAs("automacao") },
  async () => {
    await launchRecurringCharges();
  },
);
