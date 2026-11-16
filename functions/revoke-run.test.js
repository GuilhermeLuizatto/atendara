import { describe, expect, it, vi } from "vitest";

import { parseRevokeArguments, rewriteWithoutToken, runRevocation, validateActor } from "./download-token-revocation.js";

/**
 * A revogação dos links antigos roda contra produção uma vez, com a operadora
 * no teclado. Estes testes provam cada desfecho sem emulador: simulação que
 * não toca em nada, aplicação que revoga e confere, falha que sai com erro e
 * ator que não pode aplicar.
 */

const PATHS = {
  account: (id) => `accounts/${id}`,
  platformAuditLog: (id) => `platformAuditLogs/${id}`,
};
const ADMIN = {
  userId: "op-1", platformRole: "PLATFORM_ADMIN", status: "ACTIVE", mustChangePassword: false, email: "Op@Atendara.app",
};
const TOKENED = { firebaseStorageDownloadTokens: "segredo", originalName: "a.pdf" };

/** Storage e Firestore em memória: só o que o roteiro de revogação toca. */
function world({ account = ADMIN, objects = {}, failSave = [] } = {}) {
  const files = new Map(Object.entries(objects).map(([name, metadata]) => [name, { metadata: { ...metadata }, generation: 1 }]));
  const audits = [];
  const bucket = {
    getFiles: async ({ prefix }) => [
      [...files]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, file]) => ({ name, metadata: { metadata: file.metadata } })),
    ],
    file: (name) => ({
      getMetadata: async () => [{ contentType: "application/pdf", generation: files.get(name).generation, metadata: files.get(name).metadata }],
      download: async () => [Buffer.from("bytes")],
      save: async (_bytes, options) => {
        if (failSave.includes(name)) throw new Error("precondition failed");
        expect(options.preconditionOpts.ifGenerationMatch).toBe(files.get(name).generation);
        expect(options.metadata.cacheControl).toBe("private, max-age=0");
        files.set(name, { metadata: { ...options.metadata.metadata }, generation: files.get(name).generation + 1 });
      },
    }),
  };
  const db = {
    doc: (path) => ({
      get: async () => ({ data: () => (path.startsWith("accounts/") ? account : undefined) }),
      create: async (data) => { audits.push(data); },
    }),
  };
  return { bucket, db, audits, files };
}

const base = (w, extra = {}) => ({
  db: w.db, bucket: w.bucket, paths: PATHS, apply: false, actorId: "op-1", cliEmail: "op@atendara.app",
  emulator: false, runId: "run-1", projectId: "atendo-a3481", bucketName: "b",
  now: () => "2026-11-16T10:00:00.000Z", log: vi.fn(), logError: vi.fn(), newId: () => "audit-id", ...extra,
});

describe("rewriteWithoutToken", () => {
  it("regrava com os mesmos metadados menos o token, sob condição de geração", async () => {
    const w = world({ objects: { "support/org/t/m/a": TOKENED } });
    await rewriteWithoutToken(w.bucket, "support/org/t/m/a");
    expect(w.files.get("support/org/t/m/a").metadata).toEqual({ originalName: "a.pdf" });
  });
});

describe("validateActor", () => {
  const check = (w, cliEmail, emulator = false) =>
    validateActor({ db: w.db, paths: PATHS, actorId: "op-1", cliEmail, emulator });

  it.each([
    ["conta ausente", null],
    ["id diferente", { ...ADMIN, userId: "outro" }],
    ["papel sem poder", { ...ADMIN, platformRole: "PROFESSIONAL" }],
    ["conta inativa", { ...ADMIN, status: "SUSPENDED" }],
    ["senha provisória", { ...ADMIN, mustChangePassword: true }],
  ])("recusa %s", async (_, account) => {
    await expect(check(world({ account }), "op@atendara.app")).rejects.toThrow(/conta administrativa ativa/);
  });

  it("fora do emulador exige a mesma conta do firebase login, sem diferenciar caixa", async () => {
    const w = world();
    await expect(check(w, "op@atendara.app")).resolves.toBeUndefined();
    await expect(check(w, "outra@atendara.app")).rejects.toThrow(/firebase login/);
    await expect(check(w, null)).rejects.toThrow(/firebase login/);
    await expect(check(w, null, true)).resolves.toBeUndefined();
  });
});

describe("runRevocation", () => {
  const objects = {
    "paymentProofs/org-a/tx/p.pdf": TOKENED,
    "support/org-a/t/m/a": TOKENED,
    "support/org-b/t/m/b": { originalName: "b.pdf" },
    "branding/org-a/logo/x.png": TOKENED,
  };

  it("simulação não altera nem audita nada", async () => {
    const w = world({ objects });
    const { report, exitCode } = await runRevocation(base(w));
    expect(exitCode).toBe(0);
    expect(report.mode).toBe("DRY_RUN");
    expect(report.planned).toEqual({ inspected: 3, alreadyClean: 1, toRevoke: 2, byOrganization: { "org-a": 2 } });
    expect(w.audits).toHaveLength(0);
    expect(w.files.get("support/org-a/t/m/a").metadata.firebaseStorageDownloadTokens).toBe("segredo");
    expect(JSON.stringify(report)).not.toContain("segredo");
  });

  it("aplicar revoga, confere de novo e audita início e fim; o logo fica de fora", async () => {
    const w = world({ objects });
    const { report, exitCode } = await runRevocation(base(w, { apply: true }));
    expect(exitCode).toBe(0);
    expect(report.after).toEqual({ stillExposed: 0 });
    expect(w.audits.map((a) => a.action)).toEqual([
      "DOWNLOAD_TOKENS_REVOCATION_STARTED",
      "DOWNLOAD_TOKENS_REVOCATION_COMPLETED",
    ]);
    expect(w.files.get("paymentProofs/org-a/tx/p.pdf").metadata.firebaseStorageDownloadTokens).toBeUndefined();
    expect(w.files.get("branding/org-a/logo/x.png").metadata.firebaseStorageDownloadTokens).toBe("segredo");
  });

  it("falha de regravação sai com erro e registra a falha", async () => {
    const w = world({ objects, failSave: ["support/org-a/t/m/a"] });
    const options = base(w, { apply: true });
    const { report, exitCode } = await runRevocation(options);
    expect(exitCode).toBe(1);
    expect(report.failed).toEqual([{ name: "support/org-a/t/m/a", message: "precondition failed" }]);
    expect(report.after).toEqual({ stillExposed: 1 });
    expect(w.audits.at(-1).action).toBe("DOWNLOAD_TOKENS_REVOCATION_FAILED");
    expect(options.logError).toHaveBeenCalled();
  });

  it("aplicar sem nada a revogar não audita", async () => {
    const w = world({ objects: { "support/org-a/t/m/a": { originalName: "a" } } });
    const { exitCode } = await runRevocation(base(w, { apply: true }));
    expect(exitCode).toBe(0);
    expect(w.audits).toHaveLength(0);
  });

  it("ator inválido interrompe antes de listar ou gravar", async () => {
    const w = world({ objects, account: { ...ADMIN, status: "SUSPENDED" } });
    const { report, exitCode } = await runRevocation(base(w, { apply: true }));
    expect(exitCode).toBe(1);
    expect(report.error).toMatch(/conta administrativa ativa/);
    expect(report.planned).toBeUndefined();
    expect(w.audits).toHaveLength(0);
  });

  it("gera o id da trilha quando não recebe um gerador", async () => {
    const w = world({ objects });
    const options = base(w, { apply: true });
    delete options.newId;
    await runRevocation(options);
    expect(w.audits[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("parseRevokeArguments", () => {
  const PROD = "atendo-a3481";

  it("simulação em produção só precisa do projeto e do bucket", () => {
    expect(parseRevokeArguments([PROD, "--bucket", "b"], {})).toEqual({
      projectId: PROD, apply: false, actorId: null, bucketName: "b", emulator: false,
    });
  });

  it("aplicar exige o ator", () => {
    expect(parseRevokeArguments([PROD, "--bucket", "b", "--actor", "op-1", "--apply"], {})).toMatchObject({ apply: true, actorId: "op-1" });
    expect(() => parseRevokeArguments([PROD, "--bucket", "b", "--apply"], {})).toThrow("--actor");
    expect(() => parseRevokeArguments([PROD, "--bucket", "b", "--apply", "--actor"], {})).toThrow("--actor");
    expect(() => parseRevokeArguments([PROD, "--bucket", "b", "--actor", "--apply", "--apply"], {})).toThrow("--actor");
    expect(() => parseRevokeArguments([PROD, "--bucket", "b", "--actor", "a/b", "--apply"], {})).toThrow("--actor");
  });

  it("exige o bucket", () => {
    expect(() => parseRevokeArguments([PROD], {})).toThrow("--bucket");
    expect(() => parseRevokeArguments([PROD, "--bucket"], {})).toThrow("--bucket");
    expect(() => parseRevokeArguments([PROD, "--bucket", "--apply"], {})).toThrow("--bucket");
  });

  it("em produção recusa qualquer outro projeto, inclusive demo", () => {
    expect(() => parseRevokeArguments(["outro", "--bucket", "b"], {})).toThrow(PROD);
    expect(() => parseRevokeArguments(["demo-x", "--bucket", "b"], {})).toThrow(PROD);
    expect(() => parseRevokeArguments(["--bucket", "b"], {})).toThrow(PROD);
  });

  it("contra o emulador aceita só projeto demo", () => {
    const env = { FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" };
    expect(parseRevokeArguments(["demo-atendara", "--bucket", "b"], env)).toMatchObject({ emulator: true });
    expect(() => parseRevokeArguments([PROD, "--bucket", "b"], env)).toThrow("demo-*");
    expect(() => parseRevokeArguments(["--bucket", "b"], env)).toThrow("demo-*");
  });
});
