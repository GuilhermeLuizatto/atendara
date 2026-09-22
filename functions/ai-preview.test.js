import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockDataset } from "../src/mocks/index.ts";

const mock = vi.hoisted(() => ({
  store: new Map(),
  rules: [],
  classify: vi.fn(),
  reserve: vi.fn(),
  writes: vi.fn(),
}));
vi.mock("firebase-admin/firestore", () => {
  const snapshot = (path) => ({
    id: path.split("/").at(-1),
    exists: mock.store.has(path),
    data: () => mock.store.get(path),
  });
  return {
    Timestamp: class Timestamp {},
    getFirestore: () => ({
      doc: (path) => ({ get: async () => snapshot(path) }),
      collection: () => ({
        get: async () => ({
          docs: mock.rules.map((rule) => ({
            id: rule.id,
            exists: true,
            data: () => rule,
          })),
        }),
      }),
      runTransaction: mock.writes,
    }),
  };
});
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (options, handler) => Object.assign(handler, { options }),
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: mock.reserve }));
vi.mock("./gemini.js", () => ({ classifyWithGemini: mock.classify }));
const { previewAI } = await import("./ai-preview.js");
const { paths, messagePath } = await import("./generated/paths.js");
const now = new Date("2026-09-22T15:00:00Z");
const data = buildMockDataset("PSYCHOLOGIST", now);
const org = data.organization.id;
const input = {
  mode: "SIMULATOR",
  text: "Quanto preciso desembolsar para uma consulta?",
  channel: "WEB_CHAT",
  professionalId: null,
  at: now.toISOString(),
  humanHandoff: false,
  client: { modality: null, status: null, hasOutstandingBalance: null },
};
const request = (payload = input) => ({
  auth: { uid: "prof-owner", token: {} },
  data: payload,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.store.clear();
  mock.rules = data.rules.filter((rule) => !rule.immutable);
  mock.store.set(paths.account("prof-owner"), {
    status: "ACTIVE",
    platformRole: "PROFESSIONAL",
    organizationId: org,
    professionId: "PSYCHOLOGIST",
    subscriptionStatus: "ACTIVE",
    accessUntilMs: Date.now() + 86400000,
    mustChangePassword: false,
    modules: ["agente", "mensagens"],
  });
  mock.store.set(paths.organization(org), data.organization);
  mock.store.set(paths.document(org, "members", "prof-owner"), {
    role: "OWNER",
    status: "ACTIVE",
  });
  mock.classify.mockResolvedValue({
    classification: {
      classification: "ADMINISTRATIVE",
      confidence: 0.99,
      intent: "PRICING",
      matchedTerms: [],
    },
    metadata: {
      provider: "GEMINI",
      status: "SUCCEEDED",
      model: "gemini-3.1-flash-lite",
      promptVersion: "classification-1",
      inputTokens: 300,
      outputTokens: 40,
      thinkingTokens: 0,
      latencyMs: 50,
    },
  });
});

describe("prévia autenticada do agente", () => {
  it("tem App Check, segredo só no servidor e não grava decisão nem mensagem", async () => {
    expect(previewAI.options.enforceAppCheck).toBe(true);
    expect(previewAI.options.secrets).toEqual(["GEMINI_API_KEY"]);
    const result = await previewAI(request());
    expect(result.decision.action).toBe("AUTO_RESPONSE");
    expect(
      result.decision.appliedRules.some((rule) => rule.level === "SECURITY"),
    ).toBe(true);
    expect(result.decision.classifier.model).toBe("gemini-3.1-flash-lite");
    expect(mock.writes).not.toHaveBeenCalled();
    expect(mock.classify.mock.calls[0][0]).not.toHaveProperty("rules");
  });
  it("nega chamada sem autenticação", async () => {
    await expect(previewAI({ data: input })).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(mock.classify).not.toHaveBeenCalled();
  });
  it.each([
    { status: "SUSPENDED" },
    { accessUntilMs: 0 },
    { mustChangePassword: true },
    { modules: [] },
    { platformRole: "PLATFORM_ADMIN" },
    { subscriptionStatus: "CANCELLED" },
  ])("recusa conta sem acesso vigente %#", async (patch) => {
    Object.assign(mock.store.get(paths.account("prof-owner")), patch);
    await expect(previewAI(request())).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(mock.classify).not.toHaveBeenCalled();
  });
  it.each([{ role: "VIEWER" }, { status: "INACTIVE" }])(
    "não herda permissão do cliente %#",
    async (patch) => {
      Object.assign(
        mock.store.get(paths.document(org, "members", "prof-owner")),
        patch,
      );
      await expect(previewAI(request())).rejects.toMatchObject({
        code: "permission-denied",
      });
      expect(mock.classify).not.toHaveBeenCalled();
    },
  );
  it.each([
    { organizationId: "outro" },
    { permissions: ["conversation:reply"] },
    { semanticClassification: {} },
    { text: "x".repeat(4001) },
  ])("recusa adulteração do contexto %#", async (patch) => {
    await expect(
      previewAI(request({ ...input, ...patch })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mock.classify).not.toHaveBeenCalled();
  });
  it("recusa organização em exclusão e divergência de profissão", async () => {
    mock.store.set(paths.organization(org), {
      ...data.organization,
      deletion: { state: "PENDING" },
    });
    await expect(previewAI(request())).rejects.toMatchObject({
      code: "permission-denied",
    });
    mock.store.set(paths.organization(org), {
      ...data.organization,
      primaryProfession: "DOCTOR",
    });
    await expect(previewAI(request())).rejects.toMatchObject({
      code: "permission-denied",
    });
  });
  it("lê mensagem e conversa no tenant da conta e não aceita texto escolhido pelo navegador", async () => {
    const conversation = {
      id: "c1",
      organizationId: org,
      professionalId: "prof-owner",
      clientId: null,
      channel: "WHATSAPP",
      escalated: false,
    };
    mock.store.set(paths.document(org, "conversations", "c1"), conversation);
    mock.store.set(messagePath(org, "c1", "m1"), {
      id: "m1",
      organizationId: org,
      conversationId: "c1",
      direction: "INBOUND",
      body: "Qual o valor?",
    });
    await previewAI(
      request({ mode: "MESSAGE", conversationId: "c1", messageId: "m1" }),
    );
    expect(mock.classify.mock.calls[0][0].text).toBe("Qual o valor?");
    await expect(
      previewAI(
        request({
          mode: "MESSAGE",
          conversationId: "c1",
          messageId: "m1",
          text: "Outro texto",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
  it("não avalia mensagem de outra conversa ou organização", async () => {
    mock.store.set(paths.document(org, "conversations", "c1"), {
      id: "c1",
      organizationId: org,
    });
    mock.store.set(paths.document(org, "messages", "m1"), {
      id: "m1",
      organizationId: "outro",
      conversationId: "c1",
      direction: "INBOUND",
      body: "Preço?",
    });
    await expect(
      previewAI(
        request({ mode: "MESSAGE", conversationId: "c1", messageId: "m1" }),
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(mock.classify).not.toHaveBeenCalled();
  });
  it("cota da prévia esgotada não chama o modelo", async () => {
    mock.reserve.mockRejectedValueOnce({ code: "resource-exhausted" });
    await expect(previewAI(request())).rejects.toMatchObject({
      code: "resource-exhausted",
    });
    expect(mock.classify).not.toHaveBeenCalled();
  });
});
