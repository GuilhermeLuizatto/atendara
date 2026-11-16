import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Anexo de suporte: o arquivo só chega ao caminho definitivo pelo backend,
 * depois de conferir quem envia, o chamado, o tamanho e o tipo pelo conteúdo.
 * Na abertura do chamado, cada anexo declarado precisa corresponder ao objeto
 * que o backend gravou (mesmo autor, mensagem, nome, tipo e tamanho).
 */

const state = vi.hoisted(() => ({
  ticket: undefined,
  stored: new Map(),
  actor: null,
  account: null,
  batched: [],
}));

vi.mock("firebase-functions/v2/https", () => ({
  onCall: (options, handler) => Object.assign(handler, { options }),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("./service-accounts.js", () => ({ runAs: () => ({}) }));
vi.mock("./firestore-dates.js", () => ({ toStored: (_c, value) => value, fromStored: (_c, _id, value) => value }));
vi.mock("./ses.js", () => ({ emailShell: vi.fn(), escapeHtml: (value) => value, sendEmail: vi.fn(async () => {}) }));
vi.mock("./platform-auth.js", async () => {
  const { HttpsError } = await import("firebase-functions/v2/https");
  return {
    ACCOUNT_CALL_OPTIONS: {},
    accountOf: async () => state.account,
    adminOf: async () => ({}),
    parse: (schema, data) => {
      const result = schema.safeParse(data);
      if (!result.success) throw new HttpsError("invalid-argument", "Confira os dados informados.");
      return result.data;
    },
  };
});
vi.mock("./tenant-auth.js", () => ({ tenantActor: async () => state.actor }));
vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({
      file: (path) => ({
        exists: async () => [state.stored.has(path)],
        getMetadata: async () => {
          if (!state.stored.has(path)) throw new Error("não encontrado");
          const { contentType, size, metadata } = state.stored.get(path);
          return [{ contentType, size: String(size), metadata }];
        },
        save: async (bytes, options) => {
          state.stored.set(path, { contentType: options.contentType, size: bytes.length, metadata: options.metadata.metadata, options });
        },
      }),
    }),
  }),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    doc: (path) => ({
      path,
      get: async () => ({ data: () => (path.startsWith("platformSupportTickets/") ? state.ticket : undefined) }),
      update: vi.fn(),
    }),
    batch: () => ({
      create: (ref, data) => { state.batched.push({ path: ref.path, data }); },
      commit: async () => {},
    }),
  }),
}));

const { createSupportTicket, uploadSupportAttachment } = await import("./support.js");

const T = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const encode = (bytes) => Buffer.from(bytes).toString("base64");
const call = (handler, data) => handler({ data, auth: { uid: "u-1" } });
const upload = (overrides = {}) => call(uploadSupportAttachment, {
  ticketId: T, messageId: M, attachmentId: A, name: "print.png", file: encode(PNG), ...overrides,
});

const member = (overrides = {}) => ({
  userId: "u-1", organizationId: "org-a", organization: { name: "Clínica A" },
  account: { displayName: "Ana", email: "ana@x.com" }, membership: { role: "MEMBER" }, isHolder: false,
  permissions: ["support:create", "support:read"], ...overrides,
});

beforeEach(() => {
  state.ticket = undefined;
  state.stored = new Map();
  state.batched = [];
  state.account = { platformRole: "PROFESSIONAL" };
  state.actor = member();
});

describe("uploadSupportAttachment", () => {
  it("grava no caminho da organização com o autor e o tipo conferidos pelo conteúdo", async () => {
    const result = await upload();
    expect(result).toEqual({
      id: A, storagePath: `support/org-a/${T}/${M}/${A}`, name: "print.png", contentType: "image/png", size: PNG.length,
    });
    const saved = state.stored.get(result.storagePath);
    expect(saved.metadata).toMatchObject({ organizationId: "org-a", ticketId: T, messageId: M, attachmentId: A, uploaderId: "u-1", originalName: "print.png" });
    expect(saved.options.preconditionOpts).toEqual({ ifGenerationMatch: 0 });
    expect(saved.options.metadata.metadata.firebaseStorageDownloadTokens).toBeUndefined();
  });

  it("aceita PDF", async () => {
    expect((await upload({ file: encode(PDF), name: "laudo.pdf" })).contentType).toBe("application/pdf");
  });

  it("recusa conteúdo que não é imagem nem PDF, vazio ou repetido", async () => {
    await expect(upload({ file: encode(new Array(16).fill(7)) })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(upload({ file: "AAAAAAAA" })).rejects.toMatchObject({ code: "invalid-argument" });
    await upload();
    await expect(upload()).rejects.toMatchObject({ code: "already-exists" });
  });

  it("recusa mais de 5 MB", async () => {
    const big = encode([...PNG, ...new Array(5 * 1024 * 1024).fill(0)]);
    await expect(upload({ file: big })).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("anexa a chamado de outra organização? não", async () => {
    state.ticket = { organizationId: "org-b", openedBy: "u-9" };
    await expect(upload()).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("membro comum só anexa ao próprio chamado; gestor anexa ao da organização", async () => {
    state.ticket = { organizationId: "org-a", openedBy: "u-9" };
    await expect(upload()).rejects.toMatchObject({ code: "permission-denied" });
    state.ticket = { organizationId: "org-a", openedBy: "u-1" };
    await expect(upload()).resolves.toMatchObject({ id: A });
    state.stored.clear();
    state.ticket = { organizationId: "org-a", openedBy: "u-9" };
    state.actor = member({ membership: { role: "ADMIN" } });
    await expect(upload()).resolves.toMatchObject({ id: A });
  });

  it("o suporte da plataforma anexa ao chamado da organização, no caminho dela", async () => {
    state.account = { platformRole: "PLATFORM_ADMIN" };
    state.ticket = { organizationId: "org-a", openedBy: "u-9" };
    const result = await upload();
    expect(result.storagePath).toBe(`support/org-a/${T}/${M}/${A}`);
  });

  it("chamado novo exige a permissão de abrir chamado; o suporte não abre pelo anexo", async () => {
    state.actor = member({ permissions: ["support:read"] });
    await expect(upload()).rejects.toMatchObject({ code: "permission-denied" });
    state.account = { platformRole: "PLATFORM_ADMIN" };
    await expect(upload()).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("anexos na abertura do chamado", () => {
  const ticketInput = (attachments) => ({
    ticketId: T, messageId: M, category: "TECHNICAL_PROBLEM", reportedSeverity: "LOW",
    subject: "Erro ao salvar", body: "Descrição do problema encontrado.", attachments,
  });
  const declared = async (overrides = {}) => {
    const sent = await upload();
    return { id: A, storagePath: sent.storagePath, name: sent.name, contentType: sent.contentType, size: sent.size, ...overrides };
  };

  it("aceita anexo que o backend gravou", async () => {
    await expect(call(createSupportTicket, ticketInput([await declared()]))).resolves.toEqual({ ticketId: T });
    expect(state.batched).toHaveLength(2);
  });

  it("recusa anexo que não foi enviado", async () => {
    const item = { id: B, storagePath: `support/org-a/${T}/${M}/${B}`, name: "x.png", contentType: "image/png", size: 10 };
    await expect(call(createSupportTicket, ticketInput([item]))).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("recusa caminho de outra organização ou de outra mensagem", async () => {
    const item = await declared({ storagePath: `support/org-b/${T}/${M}/${A}` });
    await expect(call(createSupportTicket, ticketInput([item]))).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("recusa anexo repetido", async () => {
    const item = await declared();
    await expect(call(createSupportTicket, ticketInput([item, item]))).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it.each([
    ["nome", { name: "outro.png" }],
    ["tipo", { contentType: "application/pdf" }],
    ["tamanho", { size: 999 }],
  ])("recusa anexo cujo %s não bate com o que foi gravado", async (_, change) => {
    const item = await declared(change);
    await expect(call(createSupportTicket, ticketInput([item]))).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("recusa anexo enviado por outra pessoa", async () => {
    const item = await declared();
    state.stored.get(item.storagePath).metadata.uploaderId = "u-9";
    await expect(call(createSupportTicket, ticketInput([item]))).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
