import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  documents: new Map(),
  writes: [],
  transactions: 0,
  updateUser: vi.fn(),
  revokeRefreshTokens: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUserByEmail: vi.fn(),
    updateUser: mock.updateUser,
    revokeRefreshTokens: mock.revokeRefreshTokens,
    deleteUser: mock.deleteUser,
  }),
}));
vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { fromDate: (value) => value },
  getFirestore: () => ({
    doc: (path) => ({ path, get: async () => ({ exists: mock.documents.has(path), data: () => mock.documents.get(path) }) }),
    batch: () => ({
      create: (ref, data) => mock.writes.push({ origin: "batch", op: "create", path: ref.path, data }),
      update: (ref, data) => mock.writes.push({ origin: "batch", op: "update", path: ref.path, data }),
      set: (ref, data, options) => mock.writes.push({ origin: "batch", op: "set", path: ref.path, data, options }),
      commit: vi.fn(),
    }),
    runTransaction: async (callback) => {
      const origin = `tx-${++mock.transactions}`;
      const record = (op) => (ref, data) => mock.writes.push({ origin, op, path: ref.path, data });
      return callback({ get: (ref) => ref.get(), update: record("update"), create: record("create") });
    },
  }),
}));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_options, handler) => handler,
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: vi.fn(), networkSubject: vi.fn() }));
vi.mock("./ses.js", () => ({ escapeHtml: (value) => value, emailShell: ({ body }) => body, sendEmail: vi.fn() }));

import { removePlatformTeamMember, setPlatformTeamMemberStatus } from "./team.js";
import { paths } from "./generated/paths.js";

const TOTP = { firebase: { sign_in_second_factor: "totp" } };
const PASSWORD_ONLY = { firebase: {} };
const call = (data, uid = "operadora", token = TOTP) => ({ auth: { uid, token }, data });
const reason = "Solicitação conferida com o responsável da organização.";
const writesTo = (path) => mock.writes.filter((write) => write.path === path);

beforeEach(() => {
  vi.clearAllMocks();
  mock.documents.clear();
  mock.writes.length = 0;
  mock.transactions = 0;
  mock.documents.set(paths.account("operadora"), {
    userId: "operadora",
    status: "ACTIVE",
    platformRole: "PLATFORM_ADMIN",
    mustChangePassword: false,
  });
  mock.documents.set(paths.account("titular"), {
    userId: "titular",
    status: "ACTIVE",
    platformRole: "PROFESSIONAL",
    mustChangePassword: false,
  });
  mock.documents.set(paths.organization("org"), {
    id: "org",
    ownerId: "titular",
    primaryProfession: "PSYCHOLOGIST",
  });
  mock.documents.set(paths.document("org", "members", "assistente"), {
    id: "assistente",
    userId: "assistente",
    organizationId: "org",
    role: "ASSISTANT",
    status: "ACTIVE",
  });
  mock.updateUser.mockResolvedValue(undefined);
  mock.revokeRefreshTokens.mockResolvedValue(undefined);
  mock.deleteUser.mockResolvedValue(undefined);
});

describe("administração de membros pela operadora", () => {
  it("exige conta da operadora com segundo fator", async () => {
    const input = { organizationId: "org", memberId: "assistente", status: "SUSPENDED", reason };
    await expect(setPlatformTeamMemberStatus(call(input, "titular"))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(setPlatformTeamMemberStatus(call(input, "operadora", PASSWORD_ONLY))).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.writes).toHaveLength(0);
  });

  it("suspende, registra o ato na mesma transação e revoga sessões", async () => {
    await setPlatformTeamMemberStatus(call({ organizationId: "org", memberId: "assistente", status: "SUSPENDED", reason }));

    const [membership] = writesTo(paths.document("org", "members", "assistente"));
    const [audit] = mock.writes.filter((write) => write.path.startsWith("platformAuditLogs/"));
    expect(membership.data).toMatchObject({ status: "SUSPENDED", updatedBy: "operadora" });
    expect(audit.data).toMatchObject({
      action: "TEAM_MEMBER_SUSPENDED",
      actorId: "operadora",
      organizationId: "org",
      targetUserId: "assistente",
      reason,
    });
    expect(audit.origin).toBe(membership.origin);
    expect(mock.updateUser).toHaveBeenCalledWith("assistente", { disabled: true });
    expect(mock.revokeRefreshTokens).toHaveBeenCalledWith("assistente");
  });

  it("protege o titular e recusa motivo curto", async () => {
    await expect(setPlatformTeamMemberStatus(call({ organizationId: "org", memberId: "titular", status: "SUSPENDED", reason }))).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(setPlatformTeamMemberStatus(call({ organizationId: "org", memberId: "assistente", status: "SUSPENDED", reason: "curto" }))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mock.writes).toHaveLength(0);
  });

  it("remove com pseudonimização e as duas trilhas no mesmo lote", async () => {
    mock.documents.set(paths.document("org", "professionals", "assistente"), {
      id: "assistente",
      organizationId: "org",
      userId: "assistente",
      displayName: "Assistente",
      email: "assistente@atendara.test",
      active: true,
    });

    await removePlatformTeamMember(call({ organizationId: "org", memberId: "assistente", reason }));

    const [membership] = writesTo(paths.document("org", "members", "assistente"));
    const [professional] = writesTo(paths.document("org", "professionals", "assistente"));
    const [account] = writesTo(paths.account("assistente"));
    const platformTrail = mock.writes.filter((write) => write.path.startsWith("platformAuditLogs/"));
    const tenantTrail = mock.writes.filter((write) => write.path.startsWith("organizations/org/auditLogs/"));
    expect(membership.data).toMatchObject({ userId: null, status: "REMOVED", linkedProfessionalIds: [], updatedBy: "operadora" });
    expect(professional.data).toMatchObject({ userId: null, displayName: "Profissional removido", active: false });
    expect(account.data).toMatchObject({ displayName: "Membro removido", status: "SUSPENDED", modules: [] });
    expect(account.data).not.toHaveProperty("subscriptionStatus");
    expect(account.data).not.toHaveProperty("accessUntil");
    expect(platformTrail).toHaveLength(1);
    expect(platformTrail[0].data).toMatchObject({ action: "TEAM_MEMBER_REMOVED", actorId: "operadora", reason });
    expect(tenantTrail).toHaveLength(1);
    expect(new Set([membership, professional, account, platformTrail[0], tenantTrail[0]].map((write) => write.origin))).toEqual(new Set(["batch"]));
    expect(mock.updateUser).toHaveBeenCalledWith("assistente", { disabled: true });
    expect(mock.revokeRefreshTokens).toHaveBeenCalledWith("assistente");
    expect(mock.deleteUser).toHaveBeenCalledWith("assistente");
  });

  it("nunca remove o titular", async () => {
    await expect(removePlatformTeamMember(call({ organizationId: "org", memberId: "titular", reason }))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(mock.deleteUser).not.toHaveBeenCalled();
    expect(mock.writes).toHaveLength(0);
  });
});
