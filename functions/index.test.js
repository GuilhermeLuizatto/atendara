import { beforeEach, describe, expect, it, vi } from "vitest";
import { scryptSync } from "node:crypto";
const mock = vi.hoisted(() => ({ documents: new Map(), createUser: vi.fn(), updateUser: vi.fn(), deleteUser: vi.fn(), commit: vi.fn(), updates: [], creates: [] }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ createUser: mock.createUser, updateUser: mock.updateUser, deleteUser: mock.deleteUser }) }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({
  doc: path => ({ path, get: async () => ({ data: () => mock.documents.get(path) }) }),
  batch: () => ({ create: (ref, data) => mock.creates.push([ref.path, data]), update: (ref, data) => mock.updates.push([ref.path, data]), delete: vi.fn(), commit: mock.commit }),
  runTransaction: async callback => callback({ get: ref => ref.get(), update: (ref, data) => mock.updates.push([ref.path, data]) }),
}) }));
vi.mock("firebase-functions/v2/https", () => ({ onCall: (_options, handler) => handler, HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }));
import { registerProfessional, updateAccount, completeInitialPassword } from "./index.js";
import { paths } from "./generated/paths.js";
const request = data => ({ auth: { uid: "admin", token: { auth_time: Date.now() / 1000 } }, data });
beforeEach(() => {
  vi.clearAllMocks(); mock.documents.clear(); mock.creates.length = 0; mock.updates.length = 0;
  mock.documents.set(paths.account("admin"), { status: "ACTIVE", platformRole: "PLATFORM_ADMIN", mustChangePassword: false });
  mock.createUser.mockResolvedValue({ uid: "professional" }); mock.commit.mockResolvedValue(undefined);
});
describe("Backend de contas", () => {
  it("nega administracao sem autenticacao e sem papel confiavel", async () => {
    await expect(registerProfessional({ data: {} })).rejects.toMatchObject({ code: "unauthenticated" });
    mock.documents.set(paths.account("admin"), { status: "ACTIVE", platformRole: "PROFESSIONAL", mustChangePassword: false });
    await expect(registerProfessional(request({ platformRole: "PLATFORM_ADMIN" }))).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.createUser).not.toHaveBeenCalled();
  });
  it("cria conta com uma profissao, senha inicial e validade calculada no servidor", async () => {
    const data = { email: "teste@example.com", displayName: "Teste profissional", professionId: "PSYCHOLOGIST", modules: ["agenda"], accessUntil: "2099-01-01T00:00:00Z" };
    const result = await registerProfessional(request(data));
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(24);
    const account = mock.creates.find(([path]) => path === paths.account("professional"))[1];
    expect(account).toMatchObject({ platformRole: "PROFESSIONAL", professionId: "PSYCHOLOGIST", mustChangePassword: true, accessUntilMs: Date.parse(data.accessUntil) });
    expect(JSON.stringify(account)).not.toContain(result.temporaryPassword);
  });
  it("rejeita tentativa de criar papel de admin no payload", async () => {
    await expect(registerProfessional(request({ email: "t@example.com", displayName: "Teste", professionId: "PSYCHOLOGIST", modules: ["agenda"], accessUntil: "2099-01-01T00:00:00Z", platformRole: "PLATFORM_ADMIN" }))).rejects.toMatchObject({ code: "invalid-argument" });
  });
  it("nao permite alterar contas administrativas", async () => {
    await expect(updateAccount(request({ userId: "admin", status: "SUSPENDED", subscriptionStatus: "CANCELLED", accessUntil: null, modules: ["agenda"] }))).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("nao libera o cadastro se o Auth falhar ao trocar a senha", async () => {
    mock.documents.set(paths.account("admin"), { status: "ACTIVE", platformRole: "PLATFORM_ADMIN", mustChangePassword: true });
    mock.documents.set(paths.initialPassword("admin"), { salt: "salt", hash: scryptSync("initial-password", "salt", 32).toString("hex") });
    await expect(completeInitialPassword(request({ password: "initial-password" }))).rejects.toMatchObject({ code: "invalid-argument" });
    mock.updateUser.mockRejectedValueOnce(new Error("Auth unavailable"));
    await expect(completeInitialPassword(request({ password: "new-personal-password" }))).rejects.toThrow("Auth unavailable");
    expect(mock.updates).toHaveLength(0);
  });
});
