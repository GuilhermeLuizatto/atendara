import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A volta da ponte com o n8n (13.3), sem emulador e sem rede.
 *
 * O que estes testes protegem e uma rota PUBLICA que muda estado de aviso: se
 * ela aceitar o que nao devia, um retorno forjado marca aviso como entregue,
 * ressuscita tarefa encerrada ou mexe na fila de outra clinica. Cada recusa
 * abaixo e uma dessas portas fechada.
 */

const store = vi.hoisted(() => new Map());
const enqueued = vi.hoisted(() => []);

vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/functions", () => ({ getFunctions: vi.fn() }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/https", () => ({
  onRequest: (options, handler) => Object.assign(handler, { options }),
}));
vi.mock("firebase-functions/v2/firestore", () => ({ onDocumentWritten: (options, handler) => Object.assign(handler, { options }) }));
vi.mock("firebase-functions/v2/tasks", () => ({ onTaskDispatched: (options, handler) => Object.assign(handler, { options }) }));
vi.mock("firebase-admin/firestore", () => {
  const snapshot = (path) => ({ id: path.split("/").pop(), exists: store.has(path), data: () => store.get(path) });
  const transaction = {
    get: async (ref) => snapshot(ref.path),
    set: (ref, data) => store.set(ref.path, data),
    create: (ref, data) => {
      if (store.has(ref.path)) throw new Error(`ja existe: ${ref.path}`);
      store.set(ref.path, data);
    },
  };
  return {
    getFirestore: () => ({
      doc: (path) => ({ path, get: async () => snapshot(path) }),
      runTransaction: async (callback) => callback(transaction),
    }),
    Timestamp: class Timestamp {
      constructor(date) {
        this.date = date;
      }
      static fromDate(date) {
        return new Timestamp(date);
      }
      toDate() {
        return this.date;
      }
      toMillis() {
        return this.date.getTime();
      }
    },
  };
});

const { automationCallback, applyCallback } = await import("./automation-callback.js");
const { signBridgeMessage } = await import("./n8n-bridge.js");
const { BRIDGE_SIGNATURE_HEADER, BRIDGE_TIMESTAMP_HEADER } = await import("./generated/automation-bridge.js");
const { paths } = await import("./generated/paths.js");

const SECRET = "segredo-de-teste-b";
const ORG = "org-clinica";

/**
 * Instantes relativos ao relogio de agora.
 *
 * Data fixa aqui era uma bomba-relogio: a tarefa nascia com `expiresAt` numa
 * hora do dia, e a suite passava de manha e falhava a tarde, sem nada ter
 * mudado no codigo.
 */
function em(minutos) {
  return new Date(Date.now() + minutos * 60_000).toISOString();
}

/** Uma tarefa de aviso ja entregue ao executor, esperando o resultado. */
function seedAwaitingTask(patch = {}) {
  const task = {
    id: "tarefa-1",
    organizationId: ORG,
    type: "SEND_REMINDER",
    status: "DISPATCHED",
    attempt: 1,
    maxAttempts: 3,
    scheduledFor: em(-60),
    expiresAt: em(120),
    idempotencyKey: "chave-1",
    appointmentId: "atendimento-1",
    appointmentStartsAt: em(180),
    clientId: "cliente-1",
    professionalId: "profissional-1",
    deliveryId: "entrega-1",
    sourceTaskId: null,
    event: "APPOINTMENT_REMINDER",
    channel: "WHATSAPP",
    failureCode: null,
    stopReason: null,
    providerMessageId: null,
    dispatchingSince: null,
    completedAt: null,
    history: [
      { from: null, to: "PLANNED", at: em(-120), attempt: 1, code: null },
      { from: "PLANNED", to: "SCHEDULED", at: em(-120), attempt: 1, code: null },
      { from: "SCHEDULED", to: "DISPATCHING", at: em(-60), attempt: 1, code: null },
      { from: "DISPATCHING", to: "DISPATCHED", at: em(-59), attempt: 1, code: null },
    ],
    createdAt: em(-120),
    createdBy: null,
    updatedAt: em(-59),
    updatedBy: null,
    ...patch,
  };
  store.set(paths.document(ORG, "automationTasks", task.id), task);
  store.set(paths.document(ORG, "notificationDeliveries", "entrega-1"), {
    id: "entrega-1",
    organizationId: ORG,
    audience: "ORGANIZATION_TO_CLIENT",
    event: "APPOINTMENT_REMINDER",
    channel: "WHATSAPP",
    ruleId: "regra-1",
    appointmentId: "atendimento-1",
    clientId: "cliente-1",
    professionalId: "profissional-1",
    scheduledFor: em(-60),
    status: "SENDING",
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    providerId: "N8N_BRIDGE",
    providerMessageId: null,
    failureCode: null,
    templateId: "modelo-1",
    bodyHash: "hash",
    bodyLength: 40,
    contactHint: "0000",
    sentAt: null,
    cancelledAt: null,
    createdAt: em(-120),
    createdBy: null,
    updatedAt: em(-60),
    updatedBy: null,
  });
  return task;
}

function payload(patch = {}) {
  return {
    version: 1,
    taskId: "tarefa-1",
    organizationId: ORG,
    attempt: 1,
    outcome: "ACCEPTED",
    providerMessageId: "wamid.abc",
    failureCode: null,
    ...patch,
  };
}

/** Um pedido HTTP como o n8n faz: corpo bruto, horario e assinatura. */
function request(body, { secret = SECRET, timestamp = new Date().toISOString(), method = "POST" } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers = {
    [BRIDGE_TIMESTAMP_HEADER]: timestamp,
    [BRIDGE_SIGNATURE_HEADER]: signBridgeMessage(secret, timestamp, raw),
  };
  return { method, rawBody: Buffer.from(raw, "utf8"), get: (name) => headers[name.toLowerCase()] };
}

function response() {
  const sent = { status: null, body: null };
  return {
    sent,
    status(code) {
      sent.status = code;
      return this;
    },
    send(body) {
      sent.body = body;
      return this;
    },
    json(body) {
      sent.body = body;
      return this;
    },
  };
}

beforeEach(() => {
  store.clear();
  enqueued.length = 0;
  process.env.N8N_CALLBACK_SECRET = SECRET;
});

describe("a rota so aceita quem prova a origem", () => {
  it("recusa assinatura invalida sem dizer o motivo e sem tocar no banco", async () => {
    const task = seedAwaitingTask();
    const res = response();
    await automationCallback(request(payload(), { secret: "outro-segredo" }), res);

    expect(res.sent).toEqual({ status: 401, body: "Assinatura inválida." });
    expect(store.get(paths.document(ORG, "automationTasks", task.id)).status).toBe("DISPATCHED");
  });

  it("recusa retorno capturado e repetido depois da janela de 5 minutos", async () => {
    seedAwaitingTask();
    const res = response();
    const antigo = new Date(Date.now() - 10 * 60_000).toISOString();
    await automationCallback(request(payload(), { timestamp: antigo }), res);

    expect(res.sent.status).toBe(401);
  });

  it("recusa metodo diferente de POST e corpo fora do contrato", async () => {
    const res = response();
    await automationCallback(request(payload(), { method: "GET" }), res);
    expect(res.sent.status).toBe(405);

    const outra = response();
    await automationCallback(request({ version: 9 }), outra);
    expect(outra.sent).toEqual({ status: 400, body: "Retorno recusado." });
  });

  it("sem o segredo configurado, a rota nao funciona — e diz isso", async () => {
    delete process.env.N8N_CALLBACK_SECRET;
    const res = response();
    await automationCallback(request(payload()), res);
    expect(res.sent.status).toBe(503);
  });
});

describe("o que a tarefa do banco manda, e nao o corpo do retorno", () => {
  it("aplica o aceite: tarefa concluida, aviso enviado e trilha escrita na mesma transacao", async () => {
    seedAwaitingTask();
    const res = response();
    await automationCallback(request(payload()), res);

    expect(res.sent.status).toBe(200);
    const task = store.get(paths.document(ORG, "automationTasks", "tarefa-1"));
    const delivery = store.get(paths.document(ORG, "notificationDeliveries", "entrega-1"));
    expect(task.status).toBe("SUCCEEDED");
    expect(task.providerMessageId).toBe("wamid.abc");
    expect(delivery.status).toBe("SENT");
    expect([...store.keys()].some((key) => key.includes("/auditLogs/"))).toBe(true);
  });

  it("retorno repetido nao aplica duas vezes — e responde 200 para o n8n parar de insistir", async () => {
    seedAwaitingTask();
    await automationCallback(request(payload()), response());
    const depoisDoPrimeiro = store.get(paths.document(ORG, "notificationDeliveries", "entrega-1"));

    const res = response();
    await automationCallback(request(payload()), res);

    expect(res.sent).toMatchObject({ status: 200, body: { outcome: "ALREADY_APPLIED" } });
    expect(store.get(paths.document(ORG, "notificationDeliveries", "entrega-1")).attempts).toBe(depoisDoPrimeiro.attempts);
  });

  it("organizacao trocada no corpo nao alcanca a tarefa de outra clinica", async () => {
    seedAwaitingTask();
    const res = response();
    await automationCallback(request(payload({ organizationId: "outra-clinica" })), res);

    // A tarefa e procurada no caminho da organizacao do corpo: la nao existe.
    expect(res.sent.status).toBe(409);
    expect(store.get(paths.document(ORG, "automationTasks", "tarefa-1")).status).toBe("DISPATCHED");
  });

  it("tarefa ja encerrada nao volta a vida por um retorno", async () => {
    seedAwaitingTask({ status: "CANCELLED", completedAt: em(-30), attempt: 1 });
    const res = response();
    await automationCallback(request(payload()), res);

    expect(res.sent).toMatchObject({ status: 200, body: { outcome: "ALREADY_APPLIED" } });
    expect(store.get(paths.document(ORG, "automationTasks", "tarefa-1")).status).toBe("CANCELLED");
  });

  it("tarefa que ainda nao foi entregue ao executor recusa resultado", async () => {
    seedAwaitingTask({ status: "SCHEDULED" });
    const res = response();
    await automationCallback(request(payload()), res);

    expect(res.sent.status).toBe(409);
    expect(store.get(paths.document(ORG, "automationTasks", "tarefa-1")).status).toBe("SCHEDULED");
  });

  it("tarefa vencida recusa resultado atrasado", async () => {
    seedAwaitingTask({ expiresAt: "2020-01-01T00:00:00.000Z" });
    const res = response();
    await automationCallback(request(payload()), res);

    expect(res.sent.status).toBe(409);
  });

  it("falha temporaria devolve a tarefa para a fila, com a tentativa seguinte", async () => {
    seedAwaitingTask();
    const applied = await applyCallback(
      payload({ outcome: "TEMPORARY_FAILURE", providerMessageId: null, failureCode: "RATE_LIMITED" }),
      { clock: () => "2026-09-20T11:05:00.000Z", enqueue: (task, at) => enqueued.push({ id: task.id, attempt: task.attempt, at }) },
    );

    expect(applied.kind).toBe("APPLIED");
    expect(applied.task.status).toBe("SCHEDULED");
    expect(applied.task.attempt).toBe(2);
    expect(enqueued).toHaveLength(1);
  });

  it("recusa definitiva encerra o aviso com alerta para a equipe", async () => {
    seedAwaitingTask();
    const applied = await applyCallback(
      payload({ outcome: "REJECTED", providerMessageId: null, failureCode: "INVALID_DESTINATION" }),
      { clock: () => "2026-09-20T11:05:00.000Z", enqueue: () => {} },
    );

    expect(applied.task.status).toBe("FAILED");
    expect([...store.keys()].some((key) => key.includes("/notifications/"))).toBe(true);
  });
});
