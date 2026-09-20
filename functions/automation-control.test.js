import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A chave de emergencia e o reenvio (13.9), sem emulador.
 *
 * O que os testes protegem: a chave e do titular e da chave mestra com segundo
 * fator, nunca de quem so tem papel; desligar registra motivo na trilha; e
 * reenviar so alcanca tarefa que falhou — reenviar o que ainda esta na fila
 * mandaria a mesma mensagem duas vezes.
 */

const store = vi.hoisted(() => new Map());
const fila = vi.hoisted(() => []);

vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/functions", () => ({ getFunctions: vi.fn() }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/firestore", () => ({ onDocumentWritten: (options, handler) => Object.assign(handler, { options }) }));
vi.mock("firebase-functions/v2/tasks", () => ({ onTaskDispatched: (options, handler) => Object.assign(handler, { options }) }));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (options, handler) => Object.assign(handler, { options }),
  onRequest: (options, handler) => Object.assign(handler, { options }),
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("firebase-admin/firestore", () => {
  const snapshot = (path) => ({ id: path.split("/").pop(), exists: store.has(path), data: () => store.get(path) });
  return {
    getFirestore: () => ({
      doc: (path) => ({ path, get: async () => snapshot(path) }),
      runTransaction: async (callback) =>
        callback({
          get: async (ref) => snapshot(ref.path),
          set: (ref, data) => store.set(ref.path, data),
          create: (ref, data) => {
            if (store.has(ref.path)) throw new Error(`ja existe: ${ref.path}`);
            store.set(ref.path, data);
          },
        }),
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
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: vi.fn(async () => {}) }));
vi.mock("./automation.js", () => ({ requeueTask: vi.fn(async (task, at) => fila.push({ id: task.id, at })) }));

const controle = await import("./automation-control.js");
const { paths } = await import("./generated/paths.js");

const ORG = "org-clinica";
const TITULAR = "titular";
const ADMIN_PAPEL = "admin-papel";
const ASSISTENTE = "assistente";
const OPERADORA = "operadora";
const TOTP = { firebase: { sign_in_provider: "password", sign_in_second_factor: "totp" } };

function chamada(uid, data, token = { firebase: { sign_in_provider: "password" } }) {
  return { auth: { uid, token }, data };
}

function tarefa(patch = {}) {
  return {
    id: "tarefa-1",
    organizationId: ORG,
    type: "SEND_REMINDER",
    status: "FAILED",
    attempt: 3,
    maxAttempts: 3,
    scheduledFor: "2026-09-20T11:00:00.000Z",
    expiresAt: "2026-09-25T11:00:00.000Z",
    idempotencyKey: "chave-1",
    appointmentId: "atendimento-1",
    appointmentStartsAt: "2026-09-25T13:00:00.000Z",
    clientId: "cliente-1",
    professionalId: "profissional-1",
    deliveryId: "entrega-1",
    sourceTaskId: null,
    event: "APPOINTMENT_REMINDER",
    channel: "WHATSAPP",
    failureCode: "ATTEMPTS_EXHAUSTED",
    stopReason: null,
    providerMessageId: null,
    dispatchingSince: null,
    completedAt: "2026-09-20T12:00:00.000Z",
    history: [{ from: null, to: "PLANNED", at: "2026-09-20T10:00:00.000Z", attempt: 1, code: null }],
    createdAt: "2026-09-20T10:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-20T12:00:00.000Z",
    updatedBy: null,
    ...patch,
  };
}

beforeEach(() => {
  store.clear();
  fila.length = 0;
  store.set(paths.organization(ORG), { id: ORG, ownerId: TITULAR });
  for (const [uid, role] of [
    [TITULAR, "PROFESSIONAL"],
    [ADMIN_PAPEL, "ADMIN"],
    [ASSISTENTE, "ASSISTANT"],
  ]) {
    store.set(paths.account(uid), { id: uid, organizationId: ORG, status: "ACTIVE" });
    store.set(paths.document(ORG, "members", uid), { role, status: "ACTIVE" });
  }
  store.set(paths.account(OPERADORA), {
    id: OPERADORA,
    organizationId: null,
    status: "ACTIVE",
    platformRole: "PLATFORM_ADMIN",
    platformMaster: true,
  });
});

describe("a chave da organizacao", () => {
  it("o titular desliga, e o motivo fica na trilha", async () => {
    const resultado = await controle.setOrganizationAutomationSwitch(
      chamada(TITULAR, { enabled: false, reason: "Mensagem errada saiu para dois clientes." }),
    );

    expect(resultado).toEqual({ enabled: false });
    const chave = store.get(paths.document(ORG, "automationSwitches", "organization"));
    expect(chave).toMatchObject({ enabled: false, changedBy: TITULAR });
    expect(chave.reason).toContain("Mensagem errada");

    const trilha = [...store.entries()].find(([caminho]) => caminho.includes(`${ORG}/auditLogs/`));
    expect(trilha[1].summary).toContain("suspensa");
    expect(trilha[1].metadata).toMatchObject({ switch: "ORGANIZATION", enabled: false });
  });

  it("quem administra tambem desliga; assistente nao", async () => {
    await expect(
      controle.setOrganizationAutomationSwitch(chamada(ADMIN_PAPEL, { enabled: false, reason: "Suspendendo por hora." })),
    ).resolves.toEqual({ enabled: false });

    await expect(
      controle.setOrganizationAutomationSwitch(chamada(ASSISTENTE, { enabled: false, reason: "Quero desligar isto." })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("religar tambem e um ato registrado, com motivo", async () => {
    await controle.setOrganizationAutomationSwitch(chamada(TITULAR, { enabled: true, reason: "Problema resolvido, religando." }));
    expect(store.get(paths.document(ORG, "automationSwitches", "organization")).enabled).toBe(true);
  });

  it("motivo curto demais e recusado: a trilha precisa dizer alguma coisa", async () => {
    await expect(
      controle.setOrganizationAutomationSwitch(chamada(TITULAR, { enabled: false, reason: "erro" })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

describe("a chave geral", () => {
  it("a chave mestra com segundo fator cala a plataforma inteira", async () => {
    const resultado = await controle.setGlobalAutomationSwitch(
      chamada(OPERADORA, { enabled: false, reason: "Suspeita de envio em massa." }, TOTP),
    );

    expect(resultado).toEqual({ enabled: false });
    expect(store.get(paths.platformAutomationSwitch())).toMatchObject({ enabled: false, changedBy: OPERADORA });
    const trilha = [...store.entries()].find(([caminho]) => caminho.includes("platformAuditLogs/"));
    expect(trilha[1].details).toMatchObject({ switch: "GLOBAL", enabled: false });
  });

  it("sem segundo fator, nao: o botao que cala tudo nao depende de uma senha sozinha", async () => {
    await expect(
      controle.setGlobalAutomationSwitch(chamada(OPERADORA, { enabled: false, reason: "Sem o segundo fator." })),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(store.get(paths.platformAutomationSwitch())).toBeUndefined();
  });

  it("titular de organizacao nao alcanca a chave geral", async () => {
    await expect(
      controle.setGlobalAutomationSwitch(chamada(TITULAR, { enabled: false, reason: "Tentando calar tudo." }, TOTP)),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("reenviar uma tarefa", () => {
  beforeEach(() => {
    store.set(paths.document(ORG, "automationTasks", "tarefa-1"), tarefa());
  });

  it("tarefa que falhou volta como nova, na fila, com registro de quem pediu", async () => {
    const resultado = await controle.retryAutomationTask(chamada(ADMIN_PAPEL, { taskId: "tarefa-1" }));

    expect(resultado).toMatchObject({ taskId: "tarefa-1", status: "PLANNED" });
    const gravada = store.get(paths.document(ORG, "automationTasks", "tarefa-1"));
    expect(gravada).toMatchObject({ status: "PLANNED", attempt: 1, failureCode: null });
    expect(gravada.history.at(-1)).toMatchObject({ to: "PLANNED", code: "MANUAL_RETRY" });
    expect(fila).toHaveLength(1);

    const trilha = [...store.entries()].find(([caminho]) => caminho.includes(`${ORG}/auditLogs/`));
    expect(trilha[1].metadata).toMatchObject({ automationTaskId: "tarefa-1", previousStatus: "FAILED" });
  });

  it("tarefa que ainda esta na fila nao e reenviada: sairia duas vezes", async () => {
    store.set(paths.document(ORG, "automationTasks", "tarefa-1"), tarefa({ status: "SCHEDULED", completedAt: null }));

    await expect(controle.retryAutomationTask(chamada(ADMIN_PAPEL, { taskId: "tarefa-1" }))).rejects.toMatchObject({
      code: "failed-precondition",
    });
    expect(fila).toHaveLength(0);
  });

  it("quem so atende nao reenvia — quem ve o problema nao e quem decide reenviar", async () => {
    await expect(controle.retryAutomationTask(chamada(ASSISTENTE, { taskId: "tarefa-1" }))).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("tarefa de outra organizacao nao e encontrada", async () => {
    await expect(controle.retryAutomationTask(chamada(ADMIN_PAPEL, { taskId: "tarefa-de-outra" }))).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
