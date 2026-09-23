import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { fromStored, toStored } from "./firestore-dates.js";
import { expireWaitingTask } from "./generated/automation-expiry.js";
import {
  AUTOMATION_EXPIRY_SCAN,
  WAITING_AUTOMATION_STATUSES,
} from "./generated/automation-config.js";
import { paths, TENANT_COLLECTIONS } from "./generated/paths.js";
import { runAs } from "./service-accounts.js";

/** A transação disputa a mesma tarefa com o despachante, sem adquirir nem enviar. */
export async function expireAutomationTask(
  reference,
  now,
  firestore = getFirestore(),
) {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return false;
    const task = fromStored("automationTasks", snapshot.id, snapshot.data());
    if (
      !task.organizationId ||
      reference.path !==
        paths.document(task.organizationId, "automationTasks", task.id)
    )
      return false;
    const organization = await transaction.get(
      firestore.doc(paths.organization(task.organizationId)),
    );
    // Não recria trilha em uma organização que já está sendo eliminada.
    if (!organization.exists || organization.data().deletion) return false;
    const deliveryRef = task.deliveryId
      ? firestore.doc(
          paths.document(
            task.organizationId,
            "notificationDeliveries",
            task.deliveryId,
          ),
        )
      : null;
    const deliverySnapshot = deliveryRef
      ? await transaction.get(deliveryRef)
      : null;
    const delivery = deliverySnapshot?.exists
      ? fromStored(
          "notificationDeliveries",
          deliverySnapshot.id,
          deliverySnapshot.data(),
        )
      : null;
    const expired = expireWaitingTask(task, delivery, now);
    if (!expired) return false;
    transaction.set(reference, toStored("automationTasks", expired.task));
    if (expired.delivery)
      transaction.set(
        deliveryRef,
        toStored("notificationDeliveries", expired.delivery),
      );
    for (const effect of expired.effects) {
      transaction.create(
        firestore.doc(
          paths.document(
            task.organizationId,
            "automationTasks",
            effect.task.id,
          ),
        ),
        toStored("automationTasks", effect.task),
      );
      const collection =
        effect.kind === "WRITE_AUDIT" ? "auditLogs" : "notifications";
      const value = effect.kind === "WRITE_AUDIT" ? effect.audit : effect.alert;
      transaction.create(
        firestore.doc(
          paths.document(task.organizationId, collection, value.id),
        ),
        toStored(collection, value),
      );
    }
    return true;
  });
}

/** Cursor e limite cobrem atrasos acumulados sem reler documentos ignorados no mesmo ciclo. */
export async function sweepExpiredAutomation({
  now = new Date().toISOString(),
  firestore = getFirestore(),
  batchSize = AUTOMATION_EXPIRY_SCAN.batchSize,
  maxBatches = AUTOMATION_EXPIRY_SCAN.maxBatches,
} = {}) {
  let cursor = null;
  let scanned = 0;
  let expired = 0;
  const failures = [];
  const base = firestore
    .collectionGroup(TENANT_COLLECTIONS.automationTasks)
    .where("status", "in", [...WAITING_AUTOMATION_STATUSES])
    .where("expiresAt", "<=", Timestamp.fromDate(new Date(now)))
    .orderBy("expiresAt")
    .limit(batchSize);
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const page = await (cursor ? base.startAfter(cursor) : base).get();
    for (const document of page.docs) {
      scanned += 1;
      try {
        if (await expireAutomationTask(document.ref, now, firestore))
          expired += 1;
      } catch {
        failures.push(document.id);
      }
    }
    if (page.size < batchSize)
      return { scanned, expired, limited: false, failures };
    cursor = page.docs[page.docs.length - 1];
  }
  return { scanned, expired, limited: true, failures };
}

export const expireAutomationTasksEveryFiveMinutes = onSchedule(
  {
    schedule: AUTOMATION_EXPIRY_SCAN.schedule,
    region: "southamerica-east1",
    timeoutSeconds: 300,
    maxInstances: 1,
    retryCount: 3,
    ...runAs("automacao"),
  },
  async () => {
    const result = await sweepExpiredAutomation();
    logger.info("automation.expiry", {
      scanned: result.scanned,
      expired: result.expired,
      limited: result.limited,
      failed: result.failures.length,
    });
    if (result.limited) logger.warn("automation.expiry.backlog");
    if (result.failures.length)
      throw new Error("automation.expiry.partial_failure");
  },
);
