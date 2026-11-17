import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O gatilho do selo sem emulador.
 *
 * O que estes testes protegem: o selo usa o horario de escrita do SERVIDOR e
 * nao o que o cliente mandou; a corrente anda de um em um; reentrega do mesmo
 * evento nao grava nada de novo; e o selo nasce na mesma transacao da cabeca da
 * corrente — e o que impede duas entradas de receberem o mesmo indice.
 *
 * A prova de concorrencia de verdade esta em `audit-seal.emulator-test.js`:
 * disputa de transacao so acontece contra um banco real.
 */

const store = vi.hoisted(() => new Map());
const writes = vi.hoisted(() => []);

vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: (options, handler) => Object.assign(handler, { options }),
}));
vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    constructor(date) {
      this.date = date;
    }
    static fromDate(date) {
      return new Timestamp(date);
    }
    toDate() {
      return this.date;
    }
  }
  const snapshot = (path) => ({
    id: path.split("/").pop(),
    exists: store.has(path),
    data: () => store.get(path),
  });
  return {
    Timestamp,
    getFirestore: () => ({
      doc: (path) => ({ path }),
      runTransaction: async (callback) =>
        callback({
          getAll: async (...refs) => refs.map((ref) => snapshot(ref.path)),
          create: (ref, data) => {
            if (store.has(ref.path)) throw new Error(`ja existe: ${ref.path}`);
            store.set(ref.path, data);
            writes.push({ kind: "create", path: ref.path });
          },
          set: (ref, data) => {
            store.set(ref.path, data);
            writes.push({ kind: "set", path: ref.path });
          },
        }),
    }),
  };
});

const { CHAIN_DOCUMENT_ID, handleAuditLogCreated, sealAuditLog } = await import("./audit-seal.js");
const { verifyAuditSealChain } = await import("./audit-seal-chain.js");
const { Timestamp } = await import("firebase-admin/firestore");
const { fromStored, toStored } = await import("./firestore-dates.js");
const { paths } = await import("./generated/paths.js");

const ORG = "org-a";
/** O cliente escolhe `occurredAt`; o servidor, o horario da escrita. */
const CLIENT_AT = "2026-11-17T12:00:00.000Z";
const SERVER_AT = "2026-11-17T12:00:03.500Z";

const sealPath = (logId) => paths.document(ORG, "auditSeals", logId);
const chainPath = () => paths.document(ORG, "auditSealChains", CHAIN_DOCUMENT_ID);
const sealOf = (logId) => fromStored("auditSeals", logId, store.get(sealPath(logId)));

function eventFor(logId, { writtenAt = SERVER_AT, patch = {} } = {}) {
  const entry = {
    id: logId,
    organizationId: ORG,
    actorType: "USER",
    actorId: "membro-1",
    actorName: "Quem registrou",
    action: "CREATE",
    summary: "Cadastro fictício criado.",
    resource: { type: "client", id: "cliente-1" },
    metadata: { module: "clientes" },
    occurredAt: CLIENT_AT,
    createdAt: CLIENT_AT,
    updatedAt: CLIENT_AT,
    createdBy: "membro-1",
    updatedBy: "membro-1",
    ...patch,
  };
  const data = toStored("auditLogs", entry);
  return {
    id: `evento-${logId}`,
    params: { organizationId: ORG, logId },
    data: { exists: true, data: () => data, createTime: Timestamp.fromDate(new Date(writtenAt)) },
  };
}

beforeEach(() => {
  store.clear();
  writes.length = 0;
});

describe("gatilho do selo", () => {
  it("escuta a criacao em auditLogs e roda com a conta da automacao", () => {
    expect(sealAuditLog.options.document).toBe(paths.document("{organizationId}", "auditLogs", "{logId}"));
    expect(sealAuditLog.options.serviceAccount).toContain("fn-automacao@");
    // Repetir e inofensivo; sem `retry`, uma falha passageira deixaria entrada
    // sem selo.
    expect(sealAuditLog.options.retry).toBe(true);
  });

  it("sela a primeira entrada com o horario do servidor, nao o do cliente", async () => {
    expect(await handleAuditLogCreated(eventFor("log-1"))).toEqual({
      sealed: true,
      index: 1,
      sealHash: expect.any(String),
    });
    const seal = sealOf("log-1");
    expect(seal).toMatchObject({ index: 1, logId: "log-1", organizationId: ORG, previousSealHash: null });
    expect(seal.writtenAt).toBe(SERVER_AT);
    expect(seal.writtenAt).not.toBe(CLIENT_AT);
    // Selo e cabeca na mesma transacao: o indice nunca sai de uma leitura solta.
    expect(writes).toEqual([
      { kind: "create", path: sealPath("log-1") },
      { kind: "set", path: chainPath() },
    ]);
  });

  it("encadeia a entrada seguinte e deixa a corrente fechada", async () => {
    await handleAuditLogCreated(eventFor("log-1"));
    expect(await handleAuditLogCreated(eventFor("log-2", { writtenAt: "2026-11-17T12:00:09.000Z" }))).toMatchObject({
      sealed: true,
      index: 2,
    });
    const primeiro = sealOf("log-1");
    const segundo = sealOf("log-2");
    expect(segundo.previousSealHash).toBe(primeiro.sealHash);
    expect(fromStored("auditSealChains", CHAIN_DOCUMENT_ID, store.get(chainPath()))).toMatchObject({
      index: 2,
      sealHash: segundo.sealHash,
      logId: "log-2",
    });
    const entries = ["log-1", "log-2"].map((id) => fromStored("auditLogs", id, toStored("auditLogs", eventFor(id).data.data())));
    expect(verifyAuditSealChain({ seals: [primeiro, segundo], entries }).sealed).toBe(2);
  });

  it("reentrega do mesmo evento nao grava nada nem move a corrente", async () => {
    const event = eventFor("log-1");
    await handleAuditLogCreated(event);
    const cabeca = store.get(chainPath());
    writes.length = 0;

    expect(await handleAuditLogCreated(event)).toEqual({ sealed: false, reason: "ALREADY_SEALED", index: 1 });
    expect(writes).toEqual([]);
    expect(store.get(chainPath())).toBe(cabeca);
  });

  it("evento sem documento nao sela", async () => {
    expect(await handleAuditLogCreated({ id: "evento", params: { organizationId: ORG, logId: "log-1" }, data: null })).toEqual({
      sealed: false,
      reason: "NO_DOCUMENT",
    });
    expect(writes).toEqual([]);
  });
});
