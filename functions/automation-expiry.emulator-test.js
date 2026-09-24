import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expireAutomationTask,
  sweepExpiredAutomation,
} from "./automation-expiry.js";
import { toStored } from "./firestore-dates.js";
import { paths } from "./generated/paths.js";

const NOW = "2020-09-23T12:00:00.000Z";
const BEFORE = "2020-09-23T11:00:00.000Z";
const AFTER = "2020-09-23T13:00:00.000Z";
const ORG = `expiry-${Date.now()}`;
let app;
let db;
const ref = (collection, id, org = ORG) =>
  db.doc(paths.document(org, collection, id));
async function seed(id, patch = {}, org = ORG) {
  const task = {
    id,
    organizationId: org,
    type: "SEND_REMINDER",
    status: "SCHEDULED",
    attempt: 1,
    maxAttempts: 3,
    createdAt: BEFORE,
    updatedAt: BEFORE,
    createdBy: null,
    updatedBy: null,
    scheduledFor: BEFORE,
    expiresAt: NOW,
    idempotencyKey: id,
    appointmentId: id,
    appointmentStartsAt: AFTER,
    clientId: "client",
    professionalId: "professional",
    deliveryId: id,
    sourceTaskId: null,
    event: "APPOINTMENT_REMINDER",
    channel: "SMS",
    failureCode: null,
    stopReason: null,
    providerMessageId: null,
    dispatchingSince: null,
    completedAt: null,
    history: [
      { from: "PLANNED", to: "SCHEDULED", at: BEFORE, attempt: 1, code: null },
    ],
    ...patch,
  };
  await ref("automationTasks", id, org).set(toStored("automationTasks", task));
  await ref("notificationDeliveries", id, org).set(
    toStored("notificationDeliveries", {
      id,
      organizationId: org,
      status: "PENDING",
      nextAttemptAt: BEFORE,
    }),
  );
  return ref("automationTasks", id, org);
}

beforeAll(async () => {
  app = initializeApp({ projectId: "demo-atendara" });
  db = getFirestore();
  await db.doc(paths.organization(ORG)).set({ name: "Organização fictícia" });
});
afterAll(async () => {
  await db.recursiveDelete(db.doc(paths.organization(ORG)));
  await deleteApp(app);
});

describe("verificação de vencimento no Firestore", () => {
  it("execuções concorrentes geram exatamente um alerta e uma entrada na trilha", async () => {
    const target = await seed("concurrent");
    const result = await Promise.all([
      expireAutomationTask(target, NOW),
      expireAutomationTask(target, NOW),
    ]);
    expect(result.sort()).toEqual([false, true]);
    expect((await target.get()).data()).toMatchObject({
      status: "EXPIRED",
      stopReason: "TASK_EXPIRED",
    });
    expect(
      (await ref("notificationDeliveries", "concurrent").get()).data(),
    ).toMatchObject({ status: "CANCELLED", nextAttemptAt: null });
    const alerts = await db
      .collection(paths.collection(ORG, "notifications"))
      .get();
    const audits = await db
      .collection(paths.collection(ORG, "auditLogs"))
      .get();
    expect(alerts.size).toBe(1);
    expect(audits.size).toBe(1);
    expect(alerts.docs[0].data()).toMatchObject({
      channels: ["DASHBOARD"],
      status: "UNREAD",
    });
    expect(await expireAutomationTask(target, AFTER)).toBe(false);
  });

  it("reconfere o estado adquirido por outro executor antes de encerrar", async () => {
    for (const status of [
      "DISPATCHING",
      "DISPATCHED",
      "SUCCEEDED",
      "CANCELLED",
      "FAILED",
    ]) {
      const target = await seed(`state-${status}`, { status });
      expect(await expireAutomationTask(target, NOW)).toBe(false);
      expect((await target.get()).data().status).toBe(status);
    }
  });

  it("paginação cobre mais de um lote e ignora tarefas futuras", async () => {
    await seed("page-a");
    await seed("page-b");
    await seed("page-c");
    const future = await seed("future", { expiresAt: AFTER });
    const result = await sweepExpiredAutomation({
      now: NOW,
      batchSize: 2,
      maxBatches: 10,
    });
    expect(result).toMatchObject({ expired: 3, limited: false, failures: [] });
    expect((await future.get()).data().status).toBe("SCHEDULED");
    expect((await sweepExpiredAutomation({ now: NOW })).expired).toBe(0);
  });

  it("respeita limite de trabalho e retoma o restante no próximo ciclo", async () => {
    await seed("bounded-a");
    await seed("bounded-b");
    expect(
      await sweepExpiredAutomation({ now: NOW, batchSize: 1, maxBatches: 1 }),
    ).toMatchObject({ expired: 1, limited: true });
    expect(await sweepExpiredAutomation({ now: NOW })).toMatchObject({
      expired: 1,
      limited: false,
    });
  });

  it("não escreve em outra organização nem recria organização removida", async () => {
    const target = await seed("wrong-tenant", {
      organizationId: "another-tenant",
    });
    expect(await expireAutomationTask(target, NOW)).toBe(false);
    const absent = await seed("absent", {}, `${ORG}-missing`);
    expect(await expireAutomationTask(absent, NOW)).toBe(false);
    expect(
      (
        await ref(
          "notifications",
          "absent_RAISE_ALERT_2",
          `${ORG}-missing`,
        ).get()
      ).exists,
    ).toBe(false);
    await db.recursiveDelete(db.doc(paths.organization(`${ORG}-missing`)));
    await target.delete();
  });

  it("uma falha não deixa escrita parcial nem bloqueia outras tarefas", async () => {
    const broken = await seed("broken");
    const healthy = await seed("healthy");
    const collision = ref("auditLogs", "broken_WRITE_AUDIT_2");
    await collision.set({ reserved: true });
    const first = await sweepExpiredAutomation({ now: NOW });
    expect(first).toMatchObject({ expired: 1, failures: ["broken"] });
    expect((await broken.get()).data().status).toBe("SCHEDULED");
    expect((await healthy.get()).data().status).toBe("EXPIRED");
    expect((await ref("notifications", "broken_RAISE_ALERT_2").get()).exists).toBe(false);
    expect((await ref("notificationDeliveries", "broken").get()).data().status).toBe("PENDING");
    await collision.delete();
    expect(await sweepExpiredAutomation({ now: NOW })).toMatchObject({ expired: 1, failures: [] });
  });

  it("não grava alertas durante exclusão da organização", async () => {
    const target = await seed("deleting");
    await db
      .doc(paths.organization(ORG))
      .update({ deletion: { status: "RUNNING" } });
    expect(await expireAutomationTask(target, NOW)).toBe(false);
    expect((await target.get()).data().status).toBe("SCHEDULED");
  });
});
