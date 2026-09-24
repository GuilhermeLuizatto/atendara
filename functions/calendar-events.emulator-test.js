import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { planCalendarChange, runAutomationTask } from "./automation.js";
import { ReconnectRequiredError } from "./calendar-google.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { GOOGLE_CALENDAR_SCOPES } from "./generated/calendar-config.js";
import { paths } from "./generated/paths.js";

/**
 * Agenda Google pela fila, contra o emulador do Firestore (3C).
 *
 * Gatilho, despachante e as duas transações do resultado rodam de verdade; o
 * Google e a Cloud Tasks são dublês que registram cada pedido. Prova que o
 * evento segue o atendimento atual, que desconectar para o que estava na fila e
 * que uma autorização revogada vira pedido de reconexão.
 *
 * Rodar com: npm run test:repository
 */

const ORG = `org-agenda-${Date.now()}`;
const USER = "usuario-agenda";
const PROFILE = "perfil-agenda";
const CHANGED = "2099-03-01T12:00:00.000Z";
const START = "2099-03-02T13:00:00.000Z";
const END = "2099-03-02T14:00:00.000Z";

let db;
const doc = (collection, id) => db.doc(paths.document(ORG, collection, id));

async function read(collection, id) {
  const snapshot = await doc(collection, id).get();
  return snapshot.exists ? fromStored(collection, snapshot.id, snapshot.data()) : null;
}

async function calendarTasks(appointmentId) {
  const snapshot = await db
    .collection(paths.collection(ORG, "automationTasks"))
    .where("appointmentId", "==", appointmentId)
    .get();
  return snapshot.docs
    .map((document) => fromStored("automationTasks", document.id, document.data()))
    .filter((task) => task.type === "SYNC_CALENDAR_EVENT");
}

function appointment(id, extra = {}) {
  return {
    id,
    organizationId: ORG,
    createdAt: CHANGED,
    updatedAt: CHANGED,
    createdBy: USER,
    updatedBy: USER,
    clientId: "cliente-agenda",
    clientName: "Pessoa Fictícia",
    professionalId: PROFILE,
    professionalName: "Sam Fictício",
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

function harness() {
  const queued = [];
  const google = [];
  return {
    queued,
    google,
    planning: { enqueue: async (payload, options) => queued.push({ payload, ...options }), clock: () => CHANGED },
    dispatch: (reconcile = async () => "UPDATED") => ({
      enqueue: async (payload, options) => queued.push({ payload, ...options }),
      clock: () => CHANGED,
      google: {
        accessTokenFor: async () => "token-curto",
        reconcileEvent: async (request) => {
          google.push(request);
          return reconcile(request);
        },
      },
    }),
  };
}

async function write(before, after, run) {
  if (after) await doc("appointments", after.id).set(toStored("appointments", after));
  else await doc("appointments", before.id).delete();
  return planCalendarChange(
    { organizationId: ORG, appointmentId: (after ?? before).id, before, after, changedAt: CHANGED },
    run.planning,
  );
}

const pointer = (task) => ({ version: 1, organizationId: ORG, taskId: task.id, attempt: task.attempt });

async function connect(extra = {}) {
  await doc("calendarConnections", PROFILE).set(
    toStored("calendarConnections", {
      id: PROFILE,
      organizationId: ORG,
      professionalId: PROFILE,
      provider: "GOOGLE",
      status: "CONNECTED",
      generation: "geracao-1",
      refreshTokenCiphertext: "cifrado",
      scopes: [...GOOGLE_CALENDAR_SCOPES],
      calendarId: "agenda-atendara",
      lastError: null,
      createdAt: CHANGED,
      updatedAt: CHANGED,
      ...extra,
    }),
  );
}

beforeAll(async () => {
  initializeApp({ projectId: "demo-atendara" });
  db = getFirestore();
  await db.doc(paths.organization(ORG)).set({
    id: ORG,
    name: "Consultório Agenda",
    primaryProfession: "PSYCHOLOGIST",
    ownerId: USER,
  });
  await db.doc(paths.account(USER)).set({
    organizationId: ORG,
    status: "ACTIVE",
    platformRole: "PROFESSIONAL",
    professionId: "PSYCHOLOGIST",
    subscriptionStatus: "ACTIVE",
    accessUntil: "2199-01-01T00:00:00Z",
    modules: ["agenda"],
    mustChangePassword: false,
  });
  await doc("members", USER).set({ status: "ACTIVE", role: "PROFESSIONAL" });
  await doc("professionals", PROFILE).set({ id: PROFILE, userId: USER, active: true, displayName: "Sam Fictício" });
});

beforeEach(async () => {
  await connect();
});

afterAll(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("3C — agenda Google pela fila", () => {
  it("atendimento novo vira evento só com o horário, sem nome, e uma tarefa concluída", async () => {
    const run = harness();
    const created = appointment("novo");
    const planned = await write(null, created, run);
    expect(planned.queued).toHaveLength(1);
    expect(run.queued).toHaveLength(1);

    const [task] = await calendarTasks("novo");
    expect(task).toMatchObject({ status: "SCHEDULED", clientId: null, channel: null });
    const result = await runAutomationTask(pointer(task), run.dispatch());
    expect(result.outcome).toBe("SUCCEEDED");
    expect(run.google).toEqual([
      {
        accessToken: "token-curto",
        calendarId: "agenda-atendara",
        eventId: expect.stringMatching(/^[0-9a-v]+$/),
        // Psicologia: grau mais fechado.
        event: { summary: "Atendimento", startsAt: START, endsAt: END, description: null },
      },
    ]);
    expect(JSON.stringify(await calendarTasks("novo"))).not.toContain("Pessoa");
  });

  it("cancelar apaga o evento; ponteiro repetido não chama o Google de novo", async () => {
    const run = harness();
    const before = appointment("cancelar");
    await write(null, before, run);
    const [first] = await calendarTasks("cancelar");
    await runAutomationTask(pointer(first), run.dispatch());

    await write(before, { ...before, status: "CANCELLED" }, run);
    const second = (await calendarTasks("cancelar")).find((task) => task.id !== first.id);
    expect((await runAutomationTask(pointer(second), run.dispatch())).outcome).toBe("SUCCEEDED");
    expect((await runAutomationTask(pointer(second), run.dispatch())).outcome).toBe("TERMINAL");
    expect(run.google.map((call) => call.event === null)).toEqual([false, true]);
  });

  it("editar só a observação não gera tarefa", async () => {
    const run = harness();
    const before = appointment("observacao");
    await write(null, before, run);
    const result = await write(before, { ...before, administrativeNotes: "interna" }, run);
    expect(result.queued).toEqual([]);
  });

  it("mudança durante a execução agenda mais uma rodada", async () => {
    const run = harness();
    const before = appointment("no-meio");
    await write(null, before, run);
    const [task] = await calendarTasks("no-meio");
    const moved = { ...before, startsAt: "2099-03-03T13:00:00.000Z", endsAt: "2099-03-03T14:00:00.000Z" };
    await runAutomationTask(
      pointer(task),
      run.dispatch(async () => {
        // Remarcado enquanto o Google respondia; o gatilho ainda não rodou.
        await doc("appointments", "no-meio").set(toStored("appointments", moved));
        return "UPDATED";
      }),
    );
    const tasks = await calendarTasks("no-meio");
    expect(tasks).toHaveLength(2);
    const followUp = tasks.find((item) => item.id !== task.id);
    expect(followUp.status).toBe("SCHEDULED");
    await runAutomationTask(pointer(followUp), run.dispatch());
    expect(run.google.at(-1).event.startsAt).toBe(moved.startsAt);
  });

  it("autorização revogada: tarefa falha com alerta e a conexão pede reconexão", async () => {
    const run = harness();
    await write(null, appointment("revogado"), run);
    const [task] = await calendarTasks("revogado");
    const result = await runAutomationTask(
      pointer(task),
      run.dispatch(async () => {
        throw new ReconnectRequiredError();
      }),
    );
    expect(result.outcome).toBe("FAILED");
    expect(await read("automationTasks", task.id)).toMatchObject({
      failureCode: "CALENDAR_RECONNECT_REQUIRED",
    });
    expect(await read("calendarConnections", PROFILE)).toMatchObject({
      status: "ERROR",
      lastError: "RECONNECT_REQUIRED",
    });
    const alerts = await db
      .collection(paths.collection(ORG, "notifications"))
      .where("title", "==", "Agenda Google não atualizada")
      .get();
    expect(alerts.size).toBeGreaterThan(0);
  });

  it("desconectar com tarefa na fila: o despachante cancela sem chamar o Google", async () => {
    const run = harness();
    await write(null, appointment("desconectado"), run);
    const [task] = await calendarTasks("desconectado");
    await connect({ status: "REVOKED", refreshTokenCiphertext: null, calendarId: null });
    expect((await runAutomationTask(pointer(task), run.dispatch())).outcome).toBe("CANCELLED");
    expect(run.google).toEqual([]);
    expect(await read("automationTasks", task.id)).toMatchObject({ stopReason: "CALENDAR_NOT_CONNECTED" });
  });

  it("sem conexão apta, a escrita no atendimento não planeja nada", async () => {
    const run = harness();
    await connect({ scopes: ["https://www.googleapis.com/auth/calendar.freebusy"] });
    expect((await write(null, appointment("so-leitura"), run)).queued).toEqual([]);
  });
});
