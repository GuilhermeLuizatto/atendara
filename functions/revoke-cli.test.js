import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O script de console roda uma vez, contra produção, com a operadora no
 * teclado. Estes testes executam o arquivo de verdade com os serviços
 * trocados por dublês: provam que cada caminho (emulador, produção, falha)
 * liga os serviços certos, apaga a credencial temporária e grava o relatório.
 */

const mocks = vi.hoisted(() => ({
  initializeApp: vi.fn(),
  applicationDefault: vi.fn(() => "adc"),
  bucket: vi.fn(() => "bucket-obj"),
  mkdir: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  createCliCredential: vi.fn(),
  runRevocation: vi.fn(),
}));

vi.mock("firebase-admin/app", () => ({ initializeApp: mocks.initializeApp, applicationDefault: mocks.applicationDefault }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => "db" }));
vi.mock("firebase-admin/storage", () => ({ getStorage: () => ({ bucket: mocks.bucket }) }));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir, unlink: mocks.unlink, writeFile: mocks.writeFile }));
vi.mock("./adc-credential.js", () => ({ createCliCredential: mocks.createCliCredential }));
vi.mock("./download-token-revocation.js", async (original) => ({
  ...(await original()),
  runRevocation: mocks.runRevocation,
}));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

async function run(args, env = {}) {
  process.argv = ["node", "revoke-download-tokens.js", ...args];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  vi.resetModules();
  await import("./revoke-download-tokens.js");
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) if ("mockClear" in mock) mock.mockClear();
  mocks.runRevocation.mockResolvedValue({ report: { mode: "DRY_RUN" }, exitCode: 0 });
  mocks.createCliCredential.mockResolvedValue({ adcPath: "/tmp/adc.json", cliEmail: "op@atendara.app" });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  vi.restoreAllMocks();
});

describe("revoke-download-tokens (script)", () => {
  it("contra o emulador não deriva credencial e grava o relatório", async () => {
    await run(["demo-atendara", "--bucket", "demo-bucket"], { FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" });
    expect(mocks.initializeApp).toHaveBeenCalledWith({ projectId: "demo-atendara", storageBucket: "demo-bucket" });
    expect(mocks.createCliCredential).not.toHaveBeenCalled();
    expect(mocks.runRevocation).toHaveBeenCalledWith(expect.objectContaining({
      apply: false, emulator: true, db: "db", bucket: "bucket-obj", bucketName: "demo-bucket", cliEmail: null,
    }));
    expect(mocks.unlink).not.toHaveBeenCalled();
    const [path, content] = mocks.writeFile.mock.calls[0];
    expect(path).toMatch(/^\.local\/revoke-download-tokens-.+\.json$/);
    expect(JSON.parse(content)).toEqual({ mode: "DRY_RUN" });
    expect(process.exitCode).toBe(0);
  });

  it("em produção usa a credencial da CLI e a apaga ao terminar", async () => {
    mocks.runRevocation.mockResolvedValue({ report: { mode: "APPLY" }, exitCode: 1 });
    await run(["atendo-a3481", "--bucket", "b", "--actor", "op-1", "--apply"]);
    expect(mocks.createCliCredential).toHaveBeenCalledWith(expect.objectContaining({ projectId: "atendo-a3481", loginMessage: expect.stringContaining("firebase login") }));
    expect(mocks.initializeApp).toHaveBeenCalledWith({ credential: "adc", projectId: "atendo-a3481", storageBucket: "b" });
    expect(mocks.runRevocation).toHaveBeenCalledWith(expect.objectContaining({
      apply: true, actorId: "op-1", emulator: false, cliEmail: "op@atendara.app",
    }));
    expect(mocks.unlink).toHaveBeenCalledWith("/tmp/adc.json");
    expect(process.exitCode).toBe(1);
  });

  it("entrega à credencial uma função para carregar os módulos da CLI", async () => {
    mocks.createCliCredential.mockImplementation(async ({ loadCli }) => {
      expect(typeof loadCli).toBe("function");
      return { adcPath: "/tmp/adc.json", cliEmail: null };
    });
    await run(["atendo-a3481", "--bucket", "b"]);
    expect(mocks.createCliCredential).toHaveBeenCalled();
  });

  it("apaga a credencial mesmo se a revogação lançar", async () => {
    mocks.runRevocation.mockRejectedValue(new Error("caiu"));
    await expect(run(["atendo-a3481", "--bucket", "b"])).rejects.toThrow("caiu");
    expect(mocks.unlink).toHaveBeenCalledWith("/tmp/adc.json");
  });

  it("argumento inválido para antes de tocar em qualquer serviço", async () => {
    await expect(run(["outro-projeto", "--bucket", "b"])).rejects.toThrow("atendo-a3481");
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.runRevocation).not.toHaveBeenCalled();
  });
});
