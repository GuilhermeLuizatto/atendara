import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { planAppointmentAutomation, runAutomationTask } from "./automation.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { NOTIFICATION_CONSENT_TEXT_VERSION } from "./generated/notifications-config.js";
import { SIMULATED_DESTINATIONS, createSimulatedProvider } from "./generated/notifications-providers.js";
import { paths } from "./generated/paths.js";

/**
 * Fila de automacao contra o emulador do Firestore (Fase 3, 13.2).
 *
 * Transacao, conversao de datas e consulta dentro de transacao so falham contra
 * um banco de verdade. A Cloud Tasks e o provedor sao dubles que registram cada
 * pedido — e o que permite afirmar "pediu a fila uma vez" e "o provedor foi
 * chamado uma vez". O provedor por tras do duble e o simulado de sempre, com os
 * destinos ficticios dele.
 *
 * Rodar com: npm run test:repository
 */

const ORG = `org-automacao-${Date.now()}`;
const CHANGED = "2026-10-13T12:00:00.000Z";
const START = "2026-10-14T17:00:00.000Z";
const END = "2026-10-14T18:00:00.000Z";
const REMINDER = "2026-10-14T16:00:00.000Z";
const ACCEPTED_PHONE = "+5500900000000";

let db;

const doc = (collection, id) => db.doc(paths.document(ORG, collection, id));
const plus = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

async function read(collection, id) {
  const snapshot = await doc(collection, id).get();
  return snapshot.exists ? fromStored(collection, snapshot.id, snapshot.data()) : null;
}

async function ofAppointment(collection, appointmentId) {
  const snapshot = await db.collection(paths.collection(ORG, collection)).where("appointmentId", "==", appointmentId).get();
  return snapshot.docs.map((document) => fromStored(collection, document.id, document.data()));
}

const notices = async (appointmentId) => (await ofAppointment("automationTasks", appointmentId)).filter((task) => task.deliveryId);

async function auditOf(taskId) {
  const snapshot = await db.collection(paths.collection(ORG, "auditLogs")).where("metadata.automationTaskId", "==", taskId).get();
  return snapshot.docs.map((document) => document.data());
}

async function alertsOf(appointmentId) {
  const snapshot = await db.collection(paths.collection(ORG, "notifications")).where("target.id", "==", appointmentId).get();
  return snapshot.docs.map((document) => document.data());
}

function consentRecord(withdrawn = null) {
  return {
    granted: { at: "2026-10-01T10:00:00.000Z", recordedBy: { kind: "STAFF", userId: "dono" }, medium: "FORM" },
    textVersion: NOTIFICATION_CONSENT_TEXT_VERSION,
    subjectIsMinor: false,
    legalGuardian: null,
    withdrawn,
  };
}

async function seedClient(id, { phone = ACCEPTED_PHONE, withdrawn = false } = {}) {
  const record = consentRecord(withdrawn ? { at: "2026-10-13T15:00:00.000Z", recordedBy: { kind: "STAFF", userId: "dono" }, medium: "MESSAGE" } : null);
  await doc("clients", id).set(
    toStored("clients", {
      id,
      organizationId: ORG,
      fullName: "Rafa Ficticio Automacao",
      preferredName: "Rafa",
      email: null,
      phone,
      status: "ACTIVE",
      appointmentNotificationsEnabled: true,
      notificationConsent: { formatVersion: 2, channels: { SMS: [record] }, legacy: null },
      createdAt: CHANGED,
      updatedAt: CHANGED,
    }),
  );
}

function appointmentFor(id, clientId, extra = {}) {
  return {
    id,
    organizationId: ORG,
    createdAt: CHANGED,
    updatedAt: CHANGED,
    createdBy: "dono",
    updatedBy: "dono",
    clientId,
    clientName: "Rafa Ficticio Automacao",
    professionalId: "prof-automacao",
    professionalName: "Sam Ficticio",
    startsAt: START,
    endsAt: END,
    durationMinutes: 60,
    modality: "IN_PERSON",
    status: "SCHEDULED",
    priceInCents: 0,
    administrativeNotes: null,
    origin: "MANUAL",
    confirmedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    rescheduledFromId: null,
    externalCalendar: null,
    ...extra,
  };
}

/** O que o navegador grava, e o que o gatilho recebe dessa escrita. */
async function write(before, after, deps, changedAt = CHANGED) {
  await doc("appointments", after.id).set(toStored("appointments", after));
  return planAppointmentAutomation({ organizationId: ORG, appointmentId: after.id, before, after, changedAt }, deps);
}

function harness(planningClock = CHANGED) {
  const calls = [];
  const simulated = createSimulatedProvider();
  const send = vi.fn((request) => simulated.send(request));
  const enqueue = async (payload, options) => {
    calls.push({ payload, ...options });
  };
  return {
    calls,
    send,
    planning: { enqueue, clock: () => planningClock },
    dispatchAt: (now) => ({ enqueue, clock: () => now, providers: () => ({ id: "SIMULATED", simulated: true, send }) }),
  };
}

const pointer = (task) => ({ version: 1, organizationId: ORG, taskId: task.id, attempt: task.attempt });

beforeAll(async () => {
  initializeApp({ projectId: "demo-atendara" });
  db = getFirestore();
  await db.doc(paths.organization(ORG)).set({
    id: ORG,
    name: "Estudio Automacao",
    primaryProfession: "PERSONAL_TRAINER",
    ownerId: "dono",
    settings: {
      notifications: {
        enabled: true,
        verifiedSenderChannels: ["SMS"],
        rules: [{ id: "APPOINTMENT_REMINDER:SMS", event: "APPOINTMENT_REMINDER", channel: "SMS", enabled: true, leadMinutes: 60, customTemplate: null }],
      },
    },
  });
  await doc("professionals", "prof-automacao").set({ id: "prof-automacao", organizationId: ORG, displayName: "Sam Ficticio" });
});

afterAll(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("Fase 3, 13.2 — fila de automacao no Firestore", () => {
  it("reentrega do gatilho: uma tarefa, uma entrega e um pedido a fila", async () => {
    await seedClient("cliente-reentrega");
    const appointment = appointmentFor("atendimento-reentrega", "cliente-reentrega");
    const run = harness();

    await write(null, appointment, run.planning);
    await write(null, appointment, run.planning);

    const tasks = await notices(appointment.id);
    expect(tasks.map((task) => [task.type, task.status, task.scheduledFor, task.expiresAt])).toEqual([
      ["SEND_REMINDER", "SCHEDULED", REMINDER, START],
    ]);
    expect(await ofAppointment("notificationDeliveries", appointment.id)).toHaveLength(1);
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]).toMatchObject({ at: REMINDER, payload: pointer(tasks[0]) });
    // Datas voltam como `Timestamp`, como o navegador le.
    expect((await doc("automationTasks", tasks[0].id).get()).data().scheduledFor).toBeInstanceOf(Timestamp);
  });

  it("reentrega da Cloud Tasks: o provedor e chamado uma vez, com trilha na mesma escrita", async () => {
    await seedClient("cliente-envio");
    const appointment = appointmentFor("atendimento-envio", "cliente-envio");
    const run = harness();
    await write(null, appointment, run.planning);
    const [task] = await notices(appointment.id);

    const first = await runAutomationTask(pointer(task), run.dispatchAt(REMINDER));
    const again = await runAutomationTask(pointer(task), run.dispatchAt(plus(REMINDER, 1)));

    expect([first.outcome, again.outcome]).toEqual(["SUCCEEDED", "TERMINAL"]);
    expect(run.send).toHaveBeenCalledTimes(1);
    expect(await read("notificationDeliveries", task.id)).toMatchObject({ status: "SENT", attempts: 1, sentAt: REMINDER });
    const trail = await auditOf(task.id);
    expect(trail.map((entry) => entry.metadata.status)).toEqual(["SUCCEEDED"]);
    expect(trail[0]).toMatchObject({ actorType: "SYSTEM", actorId: null, resource: { type: "appointment", id: appointment.id } });
    expect(JSON.stringify(trail)).not.toMatch(/Rafa|5500900000000/);
    expect(await read("automationTasks", trail[0].id)).toMatchObject({ type: "WRITE_AUDIT", status: "SUCCEEDED", sourceTaskId: task.id });
  });

  it("tarefa vencida: nao envia, cancela a entrega e alerta a equipe", async () => {
    await seedClient("cliente-vencido");
    const appointment = appointmentFor("atendimento-vencido", "cliente-vencido");
    const run = harness();
    await write(null, appointment, run.planning);
    const [task] = await notices(appointment.id);

    const result = await runAutomationTask(pointer(task), run.dispatchAt(START));

    expect(result.outcome).toBe("EXPIRED");
    expect(run.send).not.toHaveBeenCalled();
    expect(await read("automationTasks", task.id)).toMatchObject({ status: "EXPIRED", stopReason: "TASK_EXPIRED" });
    expect(await read("notificationDeliveries", task.id)).toMatchObject({ status: "CANCELLED" });
    const alerts = await alertsOf(appointment.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "AUTOMATION_FAILURE", status: "UNREAD", channels: ["DASHBOARD"] });
    expect(alerts[0].body).not.toContain("Rafa");
  });

  it("consentimento retirado entre planejar e enviar: cancela sem chegar ao provedor", async () => {
    await seedClient("cliente-retirou");
    const appointment = appointmentFor("atendimento-retirou", "cliente-retirou");
    const run = harness();
    await write(null, appointment, run.planning);
    const [task] = await notices(appointment.id);

    await seedClient("cliente-retirou", { withdrawn: true });
    const result = await runAutomationTask(pointer(task), run.dispatchAt(REMINDER));

    expect(result.outcome).toBe("CANCELLED");
    expect(run.send).not.toHaveBeenCalled();
    expect(await read("automationTasks", task.id)).toMatchObject({ status: "CANCELLED", stopReason: "CONSENT_REVOKED" });
    expect(await read("notificationDeliveries", task.id)).toMatchObject({ status: "CANCELLED" });
    expect((await auditOf(task.id)).map((entry) => entry.metadata.code)).toEqual(["CONSENT_REVOKED"]);
    expect(await alertsOf(appointment.id)).toEqual([]);
  });

  it("atendimento remarcado: o gatilho troca o lembrete e o ponteiro antigo nao envia", async () => {
    await seedClient("cliente-remarcou");
    const appointment = appointmentFor("atendimento-remarcou", "cliente-remarcou");
    const run = harness();
    await write(null, appointment, run.planning);
    const [old] = await notices(appointment.id);

    const moved = { ...appointment, startsAt: "2026-10-15T17:00:00.000Z", endsAt: "2026-10-15T18:00:00.000Z", updatedAt: "2026-10-13T13:00:00.000Z" };
    await write(appointment, moved, run.planning, "2026-10-13T13:00:00.000Z");

    const tasks = await notices(appointment.id);
    expect(tasks.find((task) => task.id === old.id)).toMatchObject({ status: "CANCELLED", stopReason: "APPOINTMENT_RESCHEDULED" });
    const [current] = tasks.filter((task) => task.id !== old.id);
    expect(current).toMatchObject({ status: "SCHEDULED", scheduledFor: "2026-10-15T16:00:00.000Z" });
    expect(await read("notificationDeliveries", old.id)).toMatchObject({ status: "CANCELLED" });

    expect((await runAutomationTask(pointer(old), run.dispatchAt(REMINDER))).outcome).toBe("TERMINAL");
    expect((await runAutomationTask(pointer(current), run.dispatchAt("2026-10-15T16:00:00.000Z"))).outcome).toBe("SUCCEEDED");
    expect(run.send).toHaveBeenCalledTimes(1);
  });

  it("atendimento remarcado antes de o gatilho rodar: o despachante confere e cancela", async () => {
    await seedClient("cliente-sem-gatilho");
    const appointment = appointmentFor("atendimento-sem-gatilho", "cliente-sem-gatilho");
    const run = harness();
    await write(null, appointment, run.planning);
    const [task] = await notices(appointment.id);

    await doc("appointments", appointment.id).set(toStored("appointments", { ...appointment, startsAt: "2026-10-15T17:00:00.000Z" }));
    const result = await runAutomationTask(pointer(task), run.dispatchAt(REMINDER));

    expect(result.outcome).toBe("CANCELLED");
    expect(run.send).not.toHaveBeenCalled();
    expect(await read("automationTasks", task.id)).toMatchObject({ stopReason: "APPOINTMENT_RESCHEDULED" });
  });

  it("falha temporaria: a tentativa seguinte vai para a fila e sai na segunda", async () => {
    await seedClient("cliente-instavel", { phone: SIMULATED_DESTINATIONS.recoversOnRetry[0] });
    const appointment = appointmentFor("atendimento-instavel", "cliente-instavel");
    const run = harness();
    await write(null, appointment, run.planning);
    const [task] = await notices(appointment.id);

    expect((await runAutomationTask(pointer(task), run.dispatchAt(REMINDER))).outcome).toBe("SCHEDULED");
    const retry = run.calls.at(-1);
    expect(retry).toMatchObject({ at: plus(REMINDER, 5), payload: { taskId: task.id, attempt: 2 } });

    expect((await runAutomationTask(retry.payload, run.dispatchAt(plus(REMINDER, 5)))).outcome).toBe("SUCCEEDED");
    expect(await read("notificationDeliveries", task.id)).toMatchObject({ status: "SENT", attempts: 2 });
    expect(run.send).toHaveBeenCalledTimes(2);
    expect((await auditOf(task.id)).map((entry) => entry.metadata.status).sort()).toEqual(["SCHEDULED", "SUCCEEDED"]);
  });

  it("entregue antes da hora: devolve a fila sem mudar estado, e nao repete o proprio nome", async () => {
    await seedClient("cliente-adiantado");
    const appointment = appointmentFor("atendimento-adiantado", "cliente-adiantado");
    const run = harness();
    await write(null, appointment, run.planning);
    const [task] = await notices(appointment.id);
    const [planned] = run.calls;
    const early = plus(REMINDER, -60);

    await expect(
      runAutomationTask(pointer(task), { ...run.dispatchAt(early), currentTaskName: planned.name }),
    ).rejects.toThrow("automation.dispatch.early");
    expect(run.calls).toHaveLength(1);

    // Ponteiro que veio por outro nome (despertar de longo prazo) pede o horario certo.
    expect((await runAutomationTask(pointer(task), { ...run.dispatchAt(early), currentTaskName: "despertar-anterior" })).outcome).toBe("REQUEUED");
    expect(run.calls.at(-1)).toMatchObject({ at: REMINDER, name: planned.name });
    expect(run.send).not.toHaveBeenCalled();
    expect(await read("automationTasks", task.id)).toMatchObject({ status: "SCHEDULED", attempt: 1 });
  });

  it("execucao interrompida: dentro do prazo pede nova entrega; depois dele falha sem reenviar", async () => {
    await seedClient("cliente-interrompido");
    const appointment = appointmentFor("atendimento-interrompido", "cliente-interrompido");
    const run = harness();
    await write(null, appointment, run.planning);
    const [task] = await notices(appointment.id);
    await doc("automationTasks", task.id).update({ status: "DISPATCHING", dispatchingSince: Timestamp.fromDate(new Date(REMINDER)) });

    await expect(runAutomationTask(pointer(task), run.dispatchAt(plus(REMINDER, 1)))).rejects.toThrow("automation.dispatch.busy");
    expect((await runAutomationTask(pointer(task), run.dispatchAt(plus(REMINDER, 10)))).outcome).toBe("FAILED");

    expect(run.send).not.toHaveBeenCalled();
    expect(await read("automationTasks", task.id)).toMatchObject({ status: "FAILED", failureCode: "DISPATCH_INTERRUPTED" });
    expect(await alertsOf(appointment.id)).toHaveLength(1);
  });
});
