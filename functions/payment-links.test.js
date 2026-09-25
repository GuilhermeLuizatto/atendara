import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Link de pagamento e comprovante (cobrador, C2). O que se protege: so mes de
 * mensalidade aberto ganha link; o arquivo entra pelo tipo real e pelo
 * tamanho; um comprovante por vez; e nada fica pela metade.
 */
const mock = vi.hoisted(() => ({
  documents: new Map(),
  writes: [],
  saved: [],
  deleted: [],
  commitFails: false,
  actor: null,
}));

vi.mock("firebase-admin/firestore", async () => {
  const { Timestamp } = await vi.importActual("firebase-admin/firestore");
  const snapshot = (path) => ({
    id: path.split("/").pop(),
    exists: mock.documents.has(path),
    data: () => mock.documents.get(path),
    ref: { path, parent: { parent: { id: path.split("/")[1] } } },
  });
  const byField = (predicate) => {
    const docs = [...mock.documents.keys()].filter(predicate).map(snapshot);
    return { empty: docs.length === 0, size: docs.length, docs };
  };
  return {
    Timestamp,
    getFirestore: () => ({
      doc: (path) => ({ path, get: async () => snapshot(path) }),
      collection: (path) => ({
        where: (field, _op, value) => ({
          get: async () => byField((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/") && mock.documents.get(key)[field] === value),
        }),
      }),
      collectionGroup: (name) => ({
        where: (field, _op, value) => ({
          limit: () => ({
            get: async () => byField((key) => key.split("/").at(-2) === name && mock.documents.get(key)[field] === value),
          }),
        }),
      }),
      batch: () => {
        const writes = [];
        return {
          set: (ref, data) => writes.push({ op: "set", path: ref.path, data }),
          create: (ref, data) => writes.push({ op: "create", path: ref.path, data }),
          commit: async () => {
            if (mock.commitFails) throw Object.assign(new Error("falhou"), { code: 13 });
            mock.writes.push(...writes);
          },
        };
      },
    }),
  };
});
vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({
      file: (path) => ({
        save: async (bytes, options) => mock.saved.push({ path, size: bytes.length, contentType: options.contentType }),
        delete: async () => mock.deleted.push(path),
      }),
    }),
  }),
}));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (options, handler) => Object.assign(handler, { options }),
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: vi.fn(async () => {}), networkSubject: () => "rede" }));
vi.mock("./tenant-auth.js", () => ({
  tenantActor: vi.fn(async (_request, permission) => {
    if (!mock.actor.permissions.includes(permission)) {
      throw Object.assign(new Error("Seu papel não permite esta operação."), { code: "permission-denied" });
    }
    return mock.actor;
  }),
}));

import { createPaymentLink, inspectPaymentLink, submitPaymentProof } from "./payment-links.js";
import { paths } from "./generated/paths.js";

const ORG = "org-a";
const TX = "m1-202609";
const TOKEN = "t".repeat(43);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]).toString("base64");

function seed(transaction = {}) {
  mock.documents.set(paths.organization(ORG), { name: "Consultório Núcleo" });
  mock.documents.set(paths.document(ORG, "transactions", TX), {
    organizationId: ORG, type: "INCOME", clientId: "c1", clientName: "Ana Ficticia", professionalId: null,
    description: "Mensalidade — setembro de 2026", amountInCents: 45000, status: "PENDING", method: "PIX",
    dueDate: "2026-09-28T15:00:00.000Z", paidAt: null, recurringChargeId: "m1", period: "2026-09", ...transaction,
  });
  mock.documents.set(paths.document(ORG, "paymentLinks", TX), { organizationId: ORG, transactionId: TX, token: TOKEN, tokenHash: hash(TOKEN) });
}

beforeEach(() => {
  mock.documents = new Map();
  mock.writes = [];
  mock.saved = [];
  mock.deleted = [];
  mock.commitFails = false;
  mock.actor = {
    organizationId: ORG,
    userId: "u1",
    account: { displayName: "Profissional", modules: ["financeiro"] },
    permissions: ["transaction:create", "transaction:update"],
  };
});

describe("gerar link", () => {
  it("grava só o link e a trilha, com hash do token", async () => {
    seed();
    const { token } = await createPaymentLink({ auth: { uid: "u1" }, data: { transactionId: TX } });
    const link = mock.writes.find((write) => write.path === paths.document(ORG, "paymentLinks", TX));
    expect(link.data).toMatchObject({ transactionId: TX, token, tokenHash: hash(token) });
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(mock.writes.some((write) => write.path.startsWith(`organizations/${ORG}/auditLogs/`))).toBe(true);
  });

  it("recusa mês pago, lançamento avulso, sem financeiro e sem permissão", async () => {
    seed({ status: "PAID" });
    await expect(createPaymentLink({ auth: { uid: "u1" }, data: { transactionId: TX } })).rejects.toMatchObject({ code: "failed-precondition" });
    seed({ recurringChargeId: null });
    await expect(createPaymentLink({ auth: { uid: "u1" }, data: { transactionId: TX } })).rejects.toMatchObject({ code: "failed-precondition" });
    seed();
    mock.actor.account.modules = ["agenda"];
    await expect(createPaymentLink({ auth: { uid: "u1" }, data: { transactionId: TX } })).rejects.toMatchObject({ code: "permission-denied" });
    mock.actor.account.modules = ["financeiro"];
    mock.actor.permissions = [];
    await expect(createPaymentLink({ auth: { uid: "u1" }, data: { transactionId: TX } })).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.writes).toEqual([]);
  });
});

describe("página pública", () => {
  it("mostra só a cobrança, sem o nome da pessoa", async () => {
    seed();
    const view = await inspectPaymentLink({ data: { token: TOKEN } });
    expect(view).toMatchObject({ organizationName: "Consultório Núcleo", amountInCents: 45000, situation: "OPEN", proof: "NONE" });
    expect(JSON.stringify(view)).not.toContain("Ana Ficticia");
  });

  it("token errado não encontra nada", async () => {
    seed();
    await expect(inspectPaymentLink({ data: { token: "x".repeat(43) } })).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("envio do comprovante", () => {
  it("grava o arquivo pelo tipo real, depois registro, alerta e trilha", async () => {
    seed();
    await submitPaymentProof({ data: { token: TOKEN, file: png } });
    expect(mock.saved).toHaveLength(1);
    expect(mock.saved[0]).toMatchObject({ contentType: "image/png", size: 108 });
    expect(mock.saved[0].path.startsWith(`paymentProofs/${ORG}/${TX}/`)).toBe(true);
    const proof = mock.writes.find((write) => write.path.includes("/paymentProofs/"));
    expect(proof.data).toMatchObject({ status: "SUBMITTED", transactionId: TX, contentType: "image/png", sizeBytes: 108 });
    const alert = mock.writes.find((write) => write.path.includes("/notifications/"));
    expect(alert.data).toMatchObject({ type: "PAYMENT_PROOF_RECEIVED" });
    expect(alert.data.body).not.toContain("Ana Ficticia");
  });

  it("recusa arquivo que não é imagem nem PDF, mesmo com nome de comprovante", async () => {
    seed();
    const html = Buffer.from("<html>comprovante.pdf</html>").toString("base64");
    await expect(submitPaymentProof({ data: { token: TOKEN, file: html } })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mock.saved).toEqual([]);
  });

  it("recusa mais de 5 MB antes de gravar qualquer coisa", async () => {
    seed();
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]).toString("base64");
    await expect(submitPaymentProof({ data: { token: TOKEN, file: big } })).rejects.toBeTruthy();
    expect(mock.saved).toEqual([]);
  });

  it("um por vez: com comprovante aguardando, o segundo é recusado", async () => {
    seed();
    mock.documents.set(paths.document(ORG, "paymentProofs", "p1"), { organizationId: ORG, transactionId: TX, status: "SUBMITTED", submittedAt: "2026-09-25T10:00:00.000Z" });
    await expect(submitPaymentProof({ data: { token: TOKEN, file: png } })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(mock.saved).toEqual([]);
  });

  it("se o registro falha, o arquivo é apagado", async () => {
    seed();
    mock.commitFails = true;
    await expect(submitPaymentProof({ data: { token: TOKEN, file: png } })).rejects.toMatchObject({ code: "internal" });
    expect(mock.deleted).toEqual([mock.saved[0].path]);
  });

  it("App Check obrigatório nas três", () => {
    for (const fn of [createPaymentLink, inspectPaymentLink, submitPaymentProof]) expect(fn.options.enforceAppCheck).toBe(true);
  });
});
