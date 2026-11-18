import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nextSeal } from "./audit-seal-chain.js";

/**
 * O script de conferência roda uma vez, contra produção, com o titular no
 * teclado. Estes testes executam o arquivo de verdade com o banco e os
 * serviços trocados por dublês: provam que ele só LÊ, que liga a credencial
 * certa em cada caminho, que a apaga ao terminar, que pagina a leitura e que
 * o código de saída acompanha o relatório.
 */

const mocks = vi.hoisted(() => ({
  initializeApp: vi.fn(),
  applicationDefault: vi.fn(() => "adc"),
  mkdir: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  createCliCredential: vi.fn(),
  collection: vi.fn(),
}));

vi.mock("firebase-admin/app", () => ({
  initializeApp: mocks.initializeApp,
  applicationDefault: mocks.applicationDefault,
}));
vi.mock("firebase-admin/firestore", async (original) => ({
  ...(await original()),
  getFirestore: () => ({ collection: mocks.collection }),
}));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir, unlink: mocks.unlink, writeFile: mocks.writeFile }));
vi.mock("./adc-credential.js", () => ({ createCliCredential: mocks.createCliCredential }));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

/** Dubles de documento: o script le `id` do caminho e o corpo do `data()`. */
const docsOf = (items) => items.map((item) => ({ id: item.id, data: () => ({ ...item }) }));

/**
 * Banco de mentira que SO responde leitura. Qualquer `set`, `create`, `update`
 * ou `delete` simplesmente nao existe aqui: se o script tentasse escrever, o
 * teste quebraria com "nao e uma funcao", que e exatamente a prova desejada.
 */
function fakeDb(byPath) {
  mocks.collection.mockImplementation((path) => {
    const items = byPath[path] ?? [];
    const query = (from) => ({
      orderBy: () => query(from),
      limit: (size) => {
        const page = items.slice(from, from + size);
        return {
          startAfter: (after) => query(items.findIndex((item) => item.id === after) + 1).limit(size),
          get: async () => ({ empty: page.length === 0, size: page.length, docs: docsOf(page) }),
        };
      },
      select: () => ({ get: async () => ({ docs: docsOf(items) }) }),
    });
    return query(0);
  });
}

async function run(args, env = {}) {
  process.argv = ["node", "verify-audit-seals.js", ...args];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  vi.resetModules();
  await import("./verify-audit-seals.js");
}

const entry = (id, at) => ({
  id,
  organizationId: "org-1",
  actorId: "membro-1",
  action: "APPOINTMENT_CREATED",
  resource: { type: "appointment", id: "atendimento-1" },
  occurredAt: at,
  createdAt: at,
  summary: "Maria agendou",
  actorName: "Quem registrou",
});

/** Uma corrente intacta de duas entradas, como o gatilho a teria gravado. */
function chainOf(entries) {
  let previous = null;
  return entries.map((item) => {
    previous = nextSeal({ logId: item.id, entry: item, writtenAt: item.createdAt, previous });
    return { ...previous, id: item.id, organizationId: "org-1", createdAt: item.createdAt };
  });
}

const entries = [entry("log-1", "2026-11-18T10:00:00.000Z"), entry("log-2", "2026-11-18T11:00:00.000Z")];
const seals = chainOf(entries);

beforeEach(() => {
  for (const mock of Object.values(mocks)) if ("mockClear" in mock) mock.mockClear();
  mocks.createCliCredential.mockResolvedValue({ adcPath: "/tmp/adc.json", cliEmail: "titular@atendara.app" });
  fakeDb({
    organizations: [{ id: "org-1" }],
    "organizations/org-1/auditSeals": seals,
    "organizations/org-1/auditLogs": entries,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  vi.restoreAllMocks();
});

describe("verify-audit-seals (script)", () => {
  it("contra o emulador não deriva credencial e grava o relatório", async () => {
    await run(["demo-atendara"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });

    expect(mocks.initializeApp).toHaveBeenCalledWith({ projectId: "demo-atendara" });
    expect(mocks.createCliCredential).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();

    const [path, content] = mocks.writeFile.mock.calls[0];
    expect(path).toMatch(/^\.local\/conferencia-do-selo-.+\.json$/);
    const report = JSON.parse(content);
    expect(report.projectId).toBe("demo-atendara");
    expect(report.organizations).toEqual([expect.objectContaining({ organizationId: "org-1", ok: true, seals: 2 })]);
    expect(process.exitCode).toBe(0);
  });

  it("em produção usa a credencial da CLI e a apaga ao terminar", async () => {
    await run(["atendo-a3481"]);

    expect(mocks.createCliCredential).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "atendo-a3481", loginMessage: expect.stringContaining("firebase login") }),
    );
    expect(mocks.initializeApp).toHaveBeenCalledWith({ credential: "adc", projectId: "atendo-a3481" });
    expect(mocks.unlink).toHaveBeenCalledWith("/tmp/adc.json");
  });

  it("entrega à credencial uma função para carregar os módulos da CLI", async () => {
    mocks.createCliCredential.mockImplementation(async ({ loadCli }) => {
      expect(typeof loadCli).toBe("function");
      return { adcPath: "/tmp/adc.json" };
    });
    await run(["atendo-a3481"]);
    expect(mocks.createCliCredential).toHaveBeenCalled();
  });

  it("com --organizacao não lista as organizações", async () => {
    await run(["demo-atendara", "--organizacao", "org-1"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });

    expect(mocks.collection).not.toHaveBeenCalledWith("organizations");
    const report = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(report.organizations).toHaveLength(1);
  });

  it("organização sem trilha nenhuma fica fora do relatório", async () => {
    fakeDb({ organizations: [{ id: "org-vazia" }] });
    await run(["demo-atendara"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });

    const report = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(report.organizations).toEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it("lê a trilha em páginas: 600 entradas não cabem numa leitura só", async () => {
    const many = Array.from({ length: 600 }, (_, at) =>
      entry(`log-${String(at).padStart(4, "0")}`, "2026-11-18T10:00:00.000Z"),
    );
    fakeDb({ organizations: [{ id: "org-1" }], "organizations/org-1/auditLogs": many });
    await run(["demo-atendara"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });

    const report = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(report.organizations[0].entries).toBe(600);
  });

  it("código de saída 1 quando a corrente não fecha", async () => {
    // Selo do meio apagado: a sequencia pula e a entrada fica sem selo.
    fakeDb({
      organizations: [{ id: "org-1" }],
      "organizations/org-1/auditSeals": [seals[1]],
      "organizations/org-1/auditLogs": entries,
    });
    await run(["demo-atendara"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });

    const report = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(report.summary.withProblems).toBe(1);
    expect(process.exitCode).toBe(1);
  });

  it("apaga a credencial mesmo se a leitura lançar", async () => {
    mocks.collection.mockImplementation(() => {
      throw new Error("caiu");
    });
    await expect(run(["atendo-a3481"])).rejects.toThrow("caiu");
    expect(mocks.unlink).toHaveBeenCalledWith("/tmp/adc.json");
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("argumento inválido para antes de tocar em qualquer serviço", async () => {
    await expect(run(["outro-projeto"])).rejects.toThrow("atendo-a3481");
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.collection).not.toHaveBeenCalled();
  });
});
