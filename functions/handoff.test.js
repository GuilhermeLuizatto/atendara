import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Resposta humana pelo painel vence a resposta da Dara que esperava a vez.
 * Sem emulador: o armazém abaixo faz o papel do Firestore.
 */

const store = vi.hoisted(() => new Map());

vi.mock("firebase-functions/logger", () => ({ info: vi.fn() }));
vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentUpdated: (options, handler) => Object.assign(handler, { options }),
}));
vi.mock("firebase-admin/firestore", () => {
  const snapshot = (path) => ({
    id: path.split("/").pop(),
    exists: store.has(path),
    data: () => store.get(path),
  });
  return {
    getFirestore: () => ({
      doc: (path) => ({ path }),
      runTransaction: async (callback) => {
        const pending = new Map(store);
        const result = await callback({
          get: async (ref) => snapshot(ref.path),
          set: (ref, data, options) =>
            pending.set(
              ref.path,
              options?.merge ? { ...pending.get(ref.path), ...data } : data,
            ),
          create: (ref, data) => {
            if (pending.has(ref.path)) throw new Error(`já existe: ${ref.path}`);
            pending.set(ref.path, data);
          },
        });
        store.clear();
        for (const [path, data] of pending) store.set(path, data);
        return result;
      },
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
    },
  };
});

const { cancelReplyAfterTakeover, cancelRepliesOnHumanTakeover } = await import(
  "./handoff.js"
);
const { paths } = await import("./generated/paths.js");

const ORG = "org-clinica";
const CONVERSA = "wa-contato-1";
const TAREFA = "wa-wamid.preco-resposta";
const AGORA = "2026-09-21T14:05:00.000Z";
const caminho = (colecao, id) => paths.document(ORG, colecao, id);

function cenario({ escalated = true, status = "SCHEDULED" } = {}) {
  store.set(caminho("conversations", CONVERSA), {
    id: CONVERSA,
    organizationId: ORG,
    escalated,
    pendingAssistantTaskId: TAREFA,
  });
  store.set(caminho("automationTasks", TAREFA), {
    id: TAREFA,
    organizationId: ORG,
    type: "SEND_CONVERSATION_REPLY",
    status,
    attempt: 1,
    deliveryId: TAREFA,
    history: [],
  });
  store.set(caminho("notificationDeliveries", TAREFA), {
    id: TAREFA,
    organizationId: ORG,
    status: "PLANNED",
  });
}

const cancelar = () =>
  cancelReplyAfterTakeover({
    organizationId: ORG,
    conversationId: CONVERSA,
    clock: () => AGORA,
  });

beforeEach(() => store.clear());

describe("tomada da conversa pelo painel", () => {
  it("cancela a resposta que esperava a vez, com trilha", async () => {
    cenario();
    expect(await cancelar()).toEqual({ outcome: "CANCELLED" });
    expect(store.get(caminho("automationTasks", TAREFA))).toMatchObject({
      status: "CANCELLED",
      stopReason: "CONVERSATION_WITH_HUMAN",
    });
    expect(store.get(caminho("notificationDeliveries", TAREFA))).toMatchObject({
      status: "CANCELLED",
    });
    expect(
      store.get(caminho("conversations", CONVERSA)).pendingAssistantTaskId,
    ).toBeNull();
    expect(store.get(caminho("auditLogs", `${TAREFA}-assumida`))).toMatchObject({
      action: "UPDATE",
      resource: { type: "conversation", id: CONVERSA },
    });
  });

  it("repetir não cancela de novo nem duplica a trilha", async () => {
    cenario();
    await cancelar();
    const antes = store.size;
    expect(await cancelar()).toEqual({ outcome: "NOTHING_PENDING" });
    expect(store.size).toBe(antes);
  });

  it("conversa devolvida à Dara antes do gatilho não perde a resposta", async () => {
    cenario({ escalated: false });
    expect(await cancelar()).toEqual({ outcome: "NOTHING_PENDING" });
    expect(store.get(caminho("automationTasks", TAREFA)).status).toBe(
      "SCHEDULED",
    );
  });

  it("envio já em curso não é dado como cancelado", async () => {
    cenario({ status: "DISPATCHING" });
    expect(await cancelar()).toEqual({ outcome: "NOTHING_PENDING" });
    expect(store.get(caminho("automationTasks", TAREFA)).status).toBe(
      "DISPATCHING",
    );
  });

  it("o gatilho cancela quando a conversa chega assumida com resposta pendente", async () => {
    cenario();
    await cancelRepliesOnHumanTakeover({
      params: { organizationId: ORG, conversationId: CONVERSA },
      data: { after: { data: () => store.get(caminho("conversations", CONVERSA)) } },
    });
    expect(store.get(caminho("automationTasks", TAREFA)).status).toBe("CANCELLED");
  });

  it("o gatilho só age quando a conversa foi assumida com resposta pendente", async () => {
    cenario({ escalated: false });
    await cancelRepliesOnHumanTakeover({
      params: { organizationId: ORG, conversationId: CONVERSA },
      data: { after: { data: () => store.get(caminho("conversations", CONVERSA)) } },
    });
    expect(store.get(caminho("automationTasks", TAREFA)).status).toBe(
      "SCHEDULED",
    );
    expect(cancelRepliesOnHumanTakeover.options.document).toBe(
      paths.document("{organizationId}", "conversations", "{conversationId}"),
    );
  });
});
