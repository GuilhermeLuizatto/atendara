import { beforeEach, describe, expect, it, vi } from "vitest";

// Mesmo arranjo de index.test.js: cada escrita registra a origem (lote ou
// transacao), e e o que permite afirmar que ato e registro saem juntos.
const mock = vi.hoisted(() => ({ documents: new Map(), createUser: vi.fn(), updateUser: vi.fn(), deleteUser: vi.fn(), revokeRefreshTokens: vi.fn(), commit: vi.fn(), writes: [], transactions: 0 }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ createUser: mock.createUser, updateUser: mock.updateUser, deleteUser: mock.deleteUser, revokeRefreshTokens: mock.revokeRefreshTokens }) }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({
  doc: path => ({ path, get: async () => ({ data: () => mock.documents.get(path) }) }),
  batch: () => ({
    create: (ref, data) => mock.writes.push({ origin: "batch", op: "create", path: ref.path, data }),
    update: (ref, data) => mock.writes.push({ origin: "batch", op: "update", path: ref.path, data }),
    delete: ref => mock.writes.push({ origin: "batch", op: "delete", path: ref.path }),
    commit: mock.commit,
  }),
  runTransaction: async callback => {
    const origin = `tx-${++mock.transactions}`;
    const record = op => (ref, data) => mock.writes.push({ origin, op, path: ref.path, data });
    return callback({ get: ref => ref.get(), set: record("set"), update: record("update"), create: record("create") });
  },
}) }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/https", () => ({ onCall: (options, handler) => Object.assign(handler, { options }), onRequest: (options, handler) => Object.assign(handler, { options }), HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }));
import { createPlatformAdmin, setPlatformAdminStatus } from "./index.js";
import { paths } from "./generated/paths.js";

const TOTP = { firebase: { sign_in_provider: "password", sign_in_second_factor: "totp" } };
const PASSWORD_ONLY = { firebase: { sign_in_provider: "password" } };
const request = (data, { uid = "mestra", token = TOTP } = {}) => ({ auth: { uid, token: { auth_time: Date.now() / 1000, ...token } }, data });
const operator = extra => ({ status: "ACTIVE", platformRole: "PLATFORM_ADMIN", mustChangePassword: false, ...extra });
const newAdmin = { displayName: "Segunda Programadora", email: "segunda@nexo.test" };
const writesTo = path => mock.writes.filter(write => write.path === path);
const auditWrites = () => mock.writes.filter(write => write.path.startsWith("platformAuditLogs/"));

beforeEach(() => {
  vi.clearAllMocks(); mock.documents.clear(); mock.writes.length = 0; mock.transactions = 0;
  mock.documents.set(paths.account("mestra"), operator({ platformMaster: true }));
  mock.documents.set(paths.account("outra-mestra"), operator({ platformMaster: true }));
  mock.documents.set(paths.account("admin"), operator({ platformMaster: false }));
  mock.documents.set(paths.account("professional"), { status: "ACTIVE", platformRole: "PROFESSIONAL", organizationId: "org-p", mustChangePassword: false });
  mock.createUser.mockResolvedValue({ uid: "novo-admin" }); mock.commit.mockResolvedValue(undefined);
  mock.updateUser.mockResolvedValue(undefined); mock.revokeRefreshTokens.mockResolvedValue(undefined);
});

describe("Chave mestra e administradores da plataforma", () => {
  it("so a chave mestra, com segundo fator, cria administrador", async () => {
    await expect(createPlatformAdmin({ data: newAdmin })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(createPlatformAdmin(request(newAdmin, { uid: "admin" }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(createPlatformAdmin(request(newAdmin, { uid: "professional" }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(createPlatformAdmin(request(newAdmin, { token: PASSWORD_ONLY }))).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.createUser).not.toHaveBeenCalled();
    expect(mock.writes).toHaveLength(0);
  });

  it("cria administrador sem chave mestra, sem organizacao e sem validade, com registro no mesmo lote", async () => {
    const result = await createPlatformAdmin(request(newAdmin));
    const [account] = writesTo(paths.account("novo-admin"));
    expect(account.data).toMatchObject({ platformRole: "PLATFORM_ADMIN", platformMaster: false, organizationId: null, mustChangePassword: true, status: "ACTIVE" });
    expect(account.data).not.toHaveProperty("subscriptionStatus");
    expect(JSON.stringify(account.data)).not.toContain(result.temporaryPassword);
    expect(writesTo(paths.initialPassword("novo-admin"))).toHaveLength(1);
    expect(auditWrites().map(write => write.data)).toEqual([expect.objectContaining({ action: "PLATFORM_ADMIN_CREATED", actorId: "mestra", targetUserId: "novo-admin" })]);
    expect(new Set(mock.writes.map(write => write.origin))).toEqual(new Set(["batch"]));
  });

  it("recusa chave mestra ou papel no payload", async () => {
    await expect(createPlatformAdmin(request({ ...newAdmin, platformMaster: true }))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(createPlatformAdmin(request({ ...newAdmin, platformRole: "PROFESSIONAL" }))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mock.createUser).not.toHaveBeenCalled();
  });

  it("desfaz o usuario do Auth se o lote falhar", async () => {
    mock.commit.mockRejectedValueOnce(new Error("Firestore indisponivel"));
    await expect(createPlatformAdmin(request(newAdmin))).rejects.toMatchObject({ code: "internal" });
    expect(mock.deleteUser).toHaveBeenCalledWith("novo-admin");
  });

  it("suspende com registro na mesma transacao, desativa o login e derruba as sessoes", async () => {
    await setPlatformAdminStatus(request({ userId: "admin", status: "SUSPENDED" }));
    const [change] = writesTo(paths.account("admin"));
    expect(change.data).toEqual({ status: "SUSPENDED" });
    const [audit] = auditWrites();
    expect(audit.data).toMatchObject({ action: "PLATFORM_ADMIN_SUSPENDED", actorId: "mestra", targetUserId: "admin" });
    expect(audit.origin).toBe(change.origin);
    expect(mock.updateUser).toHaveBeenCalledWith("admin", { disabled: true });
    expect(mock.revokeRefreshTokens).toHaveBeenCalledWith("admin");
  });

  it("reativa devolvendo o login, sem derrubar sessao", async () => {
    mock.documents.set(paths.account("admin"), operator({ platformMaster: false, status: "SUSPENDED" }));
    await setPlatformAdminStatus(request({ userId: "admin", status: "ACTIVE" }));
    expect(auditWrites()[0].data).toMatchObject({ action: "PLATFORM_ADMIN_REACTIVATED" });
    expect(mock.updateUser).toHaveBeenCalledWith("admin", { disabled: false });
    expect(mock.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("nao altera a propria conta, outra chave mestra nem profissional, e administrador comum nao chama", async () => {
    await expect(setPlatformAdminStatus(request({ userId: "mestra", status: "SUSPENDED" }))).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(setPlatformAdminStatus(request({ userId: "outra-mestra", status: "SUSPENDED" }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(setPlatformAdminStatus(request({ userId: "professional", status: "SUSPENDED" }))).rejects.toMatchObject({ code: "not-found" });
    await expect(setPlatformAdminStatus(request({ userId: "mestra", status: "SUSPENDED" }, { uid: "admin" }))).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.writes).toHaveLength(0);
    expect(mock.updateUser).not.toHaveBeenCalled();
  });
});
