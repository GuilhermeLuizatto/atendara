import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A fiacao das duas functions, sem banco. O comportamento contra um Firestore de
// verdade esta em automation.emulator-test.js.
const mock = vi.hoisted(() => ({ getFirestore: vi.fn() }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: mock.getFirestore, Timestamp: class {} }));
vi.mock("firebase-admin/functions", () => ({ getFunctions: vi.fn() }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/firestore", () => ({ onDocumentWritten: (options, handler) => Object.assign(handler, { options }) }));
vi.mock("firebase-functions/v2/tasks", () => ({ onTaskDispatched: (options, handler) => Object.assign(handler, { options }) }));

import { dispatchAutomationTask, planAppointmentNotices, runAutomationTask } from "./automation.js";
import { DISPATCHER_QUEUE_RETRY, DISPATCHER_TIMEOUT_SECONDS } from "./generated/automation-config.js";

beforeEach(() => vi.clearAllMocks());

describe("fiacao da fila de automacao", () => {
  it("o gatilho escuta toda escrita de atendimento, na regiao do banco, e repete em erro", () => {
    expect(planAppointmentNotices.options).toMatchObject({
      document: "organizations/{organizationId}/appointments/{appointmentId}",
      region: "southamerica-east1",
      retry: true,
    });
  });

  it("o despachante e uma fila da Cloud Tasks com prazo e tentativas de entrega configurados", () => {
    expect(dispatchAutomationTask.options).toMatchObject({
      region: "southamerica-east1",
      timeoutSeconds: DISPATCHER_TIMEOUT_SECONDS,
      retryConfig: DISPATCHER_QUEUE_RETRY,
    });
  });

  it("evento velho do gatilho e descartado sem ler o banco", async () => {
    await planAppointmentNotices({ time: "2020-01-01T00:00:00.000Z", id: "evt", params: {}, data: undefined });
    expect(mock.getFirestore).not.toHaveBeenCalled();
  });

  it("ponteiro fora do contrato e descartado sem ler o banco", async () => {
    for (const payload of [null, {}, { version: 2, organizationId: "org", taskId: "t", attempt: 1 }, { version: 1, organizationId: "org", taskId: "t", attempt: 1, destination: "+55" }]) {
      expect(await runAutomationTask(payload)).toEqual({ outcome: "INVALID_PAYLOAD" });
    }
    expect(mock.getFirestore).not.toHaveBeenCalled();
  });

  it("o backend da fila nao fala com servico externo nem registra contato ou texto", () => {
    const source = readFileSync(new URL("./automation.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    // Logs so com ids, tipo e resultado.
    for (const call of source.match(/logger\.\w+\([^)]*\)/g) ?? []) {
      expect(call).not.toMatch(/destination|body|phone|email|fullName/);
    }
  });
});
