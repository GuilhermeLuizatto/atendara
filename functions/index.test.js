import { readdirSync, readFileSync } from "node:fs";
import { scryptSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Cada escrita e registrada com a origem: lote (`batch`) ou transacao (`tx`,
// numerada). E o que permite afirmar que ato e registro saem juntos.
const mock = vi.hoisted(() => ({ documents: new Map(), createUser: vi.fn(), updateUser: vi.fn(), deleteUser: vi.fn(), commit: vi.fn(), writes: [], transactions: 0 }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ createUser: mock.createUser, updateUser: mock.updateUser, deleteUser: mock.deleteUser }) }));
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
// `onRequest` entra porque index.js reexporta o webhook de cobranca; sem ele o
// modulo nem carrega. O comportamento do webhook e testado em billing.test.js.
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/https", () => ({ onCall: (options, handler) => Object.assign(handler, { options }), onRequest: (options, handler) => Object.assign(handler, { options }), HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }));
import * as backend from "./index.js";
import { paths } from "./generated/paths.js";
import { MAX_ACCESS_GRANT_DAYS } from "./generated/platform-config.js";

const { registerProfessional, updateAccount, completeInitialPassword, grantAccess, revokeAccess } = backend;
const DAY = 86_400_000;
const inDays = days => new Date(Date.now() + days * DAY).toISOString();
const TOTP = { firebase: { sign_in_provider: "password", sign_in_second_factor: "totp" } };
const PASSWORD_ONLY = { firebase: { sign_in_provider: "password" } };
const request = (data, { uid = "admin", token = TOTP } = {}) => ({ auth: { uid, token: { auth_time: Date.now() / 1000, ...token } }, data });
const registration = extra => ({ email: "teste@example.com", displayName: "Teste profissional", professionId: "PSYCHOLOGIST", modules: ["agenda"], ...extra });
const grant = extra => ({ organizationId: "org-p", kind: "PILOT", until: inDays(30), reason: "Piloto combinado com a clinica.", ...extra });
const writesTo = path => mock.writes.filter(write => write.path === path);
const auditWrites = () => mock.writes.filter(write => write.path.startsWith("platformAuditLogs/"));

beforeEach(() => {
  vi.clearAllMocks(); mock.documents.clear(); mock.writes.length = 0; mock.transactions = 0;
  mock.documents.set(paths.account("admin"), { status: "ACTIVE", platformRole: "PLATFORM_ADMIN", mustChangePassword: false });
  mock.documents.set(paths.account("professional"), { status: "ACTIVE", platformRole: "PROFESSIONAL", organizationId: "org-p", modules: ["agenda"], mustChangePassword: false });
  mock.documents.set(paths.organization("org-p"), { id: "org-p", ownerId: "professional" });
  mock.createUser.mockResolvedValue({ uid: "novo" }); mock.commit.mockResolvedValue(undefined);
});

describe("Backend de contas", () => {
  it("nega administracao sem autenticacao, sem papel confiavel e sem segundo fator", async () => {
    await expect(registerProfessional({ data: {} })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(registerProfessional(request(registration(), { uid: "professional" }))).rejects.toMatchObject({ code: "permission-denied" });
    // Senha da operadora sozinha nao basta, nem SMS no lugar do TOTP.
    await expect(registerProfessional(request(registration(), { token: PASSWORD_ONLY }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(registerProfessional(request(registration(), { token: { firebase: { sign_in_second_factor: "phone" } } }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(updateAccount(request({ userId: "professional", status: "SUSPENDED", modules: ["agenda"] }, { token: PASSWORD_ONLY }))).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.createUser).not.toHaveBeenCalled();
    expect(mock.writes).toHaveLength(0);
  });

  it("cria conta pendente, sem validade, com senha inicial e registro do cadastro", async () => {
    const result = await registerProfessional(request(registration()));
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(24);
    const account = writesTo(paths.account("novo"))[0].data;
    expect(account).toMatchObject({ platformRole: "PROFESSIONAL", professionId: "PSYCHOLOGIST", mustChangePassword: true, subscriptionStatus: "PENDING", accessUntil: null, accessUntilMs: 0 });
    expect(JSON.stringify(account)).not.toContain(result.temporaryPassword);
    expect(mock.writes.some(write => write.path.startsWith("platformAccessGrants/"))).toBe(false);
    expect(auditWrites().map(write => write.data)).toEqual([expect.objectContaining({ action: "ACCOUNT_REGISTERED", actorId: "admin", targetUserId: "novo" })]);
    expect(auditWrites()[0].origin).toBe("batch");
  });

  it("recusa situacao ou validade no payload do cadastro e da alteracao", async () => {
    // Antes da 5B, estes quatro payloads abriam o painel sem registro.
    await expect(registerProfessional(request(registration({ accessUntil: inDays(30) })))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(registerProfessional(request(registration({ subscriptionStatus: "ACTIVE" })))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(updateAccount(request({ userId: "professional", status: "ACTIVE", subscriptionStatus: "ACTIVE", modules: ["agenda"] }))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(updateAccount(request({ userId: "professional", status: "ACTIVE", accessUntil: inDays(30), modules: ["agenda"] }))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mock.createUser).not.toHaveBeenCalled();
    expect(mock.writes).toHaveLength(0);
  });

  it("rejeita tentativa de criar papel de admin no payload", async () => {
    await expect(registerProfessional(request(registration({ platformRole: "PLATFORM_ADMIN" })))).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("alteracao de conta muda so situacao e modulos, com registro na mesma transacao", async () => {
    await updateAccount(request({ userId: "professional", status: "SUSPENDED", modules: ["agenda", "clientes"] }));
    const [change] = writesTo(paths.account("professional"));
    expect(Object.keys(change.data).sort()).toEqual(["modules", "status"]);
    const [audit] = auditWrites();
    expect(audit.data).toMatchObject({ action: "ACCOUNT_UPDATED", targetUserId: "professional", details: { status: { from: "ACTIVE", to: "SUSPENDED" } } });
    expect(audit.origin).toBe(change.origin);
  });

  it("nao permite alterar contas administrativas", async () => {
    await expect(updateAccount(request({ userId: "admin", status: "SUSPENDED", modules: ["agenda"] }))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("nao libera o cadastro se o Auth falhar ao trocar a senha", async () => {
    mock.documents.set(paths.account("admin"), { status: "ACTIVE", platformRole: "PLATFORM_ADMIN", mustChangePassword: true });
    mock.documents.set(paths.initialPassword("admin"), { salt: "salt", hash: scryptSync("initial-password", "salt", 32).toString("hex") });
    await expect(completeInitialPassword(request({ password: "initial-password" }, { token: PASSWORD_ONLY }))).rejects.toMatchObject({ code: "invalid-argument" });
    mock.updateUser.mockRejectedValueOnce(new Error("Auth unavailable"));
    await expect(completeInitialPassword(request({ password: "new-personal-password" }, { token: PASSWORD_ONLY }))).rejects.toThrow("Auth unavailable");
    expect(mock.writes).toHaveLength(0);
  });
});

describe("Concessao manual registrada", () => {
  it("concessao inicial no cadastro abre o portao pelo mesmo caminho e com registro", async () => {
    const until = inDays(15);
    await registerProfessional(request(registration({ initialGrant: { kind: "PILOT", until, reason: "Piloto combinado com a clinica." } })));
    expect(writesTo(paths.account("novo"))[0].data).toMatchObject({ subscriptionStatus: "ACTIVE", accessUntil: until, accessUntilMs: Date.parse(until) });
    const organizationId = writesTo(paths.account("novo"))[0].data.organizationId;
    expect(writesTo(paths.platformAccessGrant(organizationId))[0].data).toMatchObject({ kind: "PILOT", until, grantedBy: "admin", revokedAt: null });
    expect(auditWrites().map(write => write.data.action).sort()).toEqual(["ACCESS_GRANTED", "ACCOUNT_REGISTERED"]);
    expect(new Set(mock.writes.map(write => write.origin))).toEqual(new Set(["batch"]));
    expect(mock.commit).toHaveBeenCalledTimes(1);
  });

  it("recusa prazo acima do maximo, sem motivo ou sem tipo", async () => {
    await expect(registerProfessional(request(registration({ initialGrant: { kind: "PILOT", until: inDays(MAX_ACCESS_GRANT_DAYS + 1), reason: "Piloto combinado com a clinica." } })))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mock.createUser).not.toHaveBeenCalled();
    await expect(grantAccess(request(grant({ until: inDays(MAX_ACCESS_GRANT_DAYS + 1) })))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(grantAccess(request(grant({ until: inDays(-1) })))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(grantAccess(request(grant({ reason: "curto" })))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(grantAccess(request(grant({ kind: "OUTRO" })))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mock.writes).toHaveLength(0);
  });

  it("concede, grava a concessao, o portao e o registro na mesma transacao", async () => {
    const until = inDays(20);
    await grantAccess(request(grant({ until })));
    const [grantWrite] = writesTo(paths.platformAccessGrant("org-p"));
    const [accountWrite] = writesTo(paths.account("professional"));
    const [audit] = auditWrites();
    expect(grantWrite.data).toMatchObject({ organizationId: "org-p", subscriberUserId: "professional", kind: "PILOT", until });
    expect(accountWrite.data).toEqual({ subscriptionStatus: "ACTIVE", accessUntil: until, accessUntilMs: Date.parse(until) });
    expect(audit.data).toMatchObject({ action: "ACCESS_GRANTED", actorId: "admin", organizationId: "org-p", reason: "Piloto combinado com a clinica." });
    expect(new Set([grantWrite.origin, accountWrite.origin, audit.origin])).toEqual(new Set(["tx-1"]));
  });

  it("concessao nunca encurta ciclo pago", async () => {
    const paidUntil = inDays(60);
    mock.documents.set(paths.platformSubscription("org-p"), { status: "ACTIVE", accessUntil: paidUntil });
    await grantAccess(request(grant({ until: inDays(10) })));
    expect(writesTo(paths.account("professional"))[0].data).toMatchObject({ subscriptionStatus: "ACTIVE", accessUntil: paidUntil });
  });

  it("revogacao fecha so a parte concedida e fica registrada", async () => {
    mock.documents.set(paths.platformAccessGrant("org-p"), { organizationId: "org-p", kind: "COURTESY", until: inDays(20), revokedAt: null });
    await revokeAccess(request({ organizationId: "org-p", reason: "Cortesia encerrada a pedido." }));
    expect(writesTo(paths.account("professional"))[0].data).toEqual({ subscriptionStatus: "PENDING", accessUntil: null, accessUntilMs: 0 });
    expect(writesTo(paths.platformAccessGrant("org-p"))[0].data).toMatchObject({ revokedBy: "admin", revokeReason: "Cortesia encerrada a pedido." });
    expect(auditWrites()[0].data).toMatchObject({ action: "ACCESS_REVOKED", reason: "Cortesia encerrada a pedido." });

    mock.writes.length = 0;
    const paidUntil = inDays(8);
    mock.documents.set(paths.platformSubscription("org-p"), { status: "ACTIVE", accessUntil: paidUntil });
    await revokeAccess(request({ organizationId: "org-p", reason: "Cortesia encerrada a pedido." }));
    expect(writesTo(paths.account("professional"))[0].data).toMatchObject({ subscriptionStatus: "ACTIVE", accessUntil: paidUntil });
  });

  it("nao revoga o que nao esta vigente", async () => {
    await expect(revokeAccess(request({ organizationId: "org-p", reason: "Cortesia encerrada a pedido." }))).rejects.toMatchObject({ code: "failed-precondition" });
    mock.documents.set(paths.platformAccessGrant("org-p"), { until: inDays(-1), revokedAt: null });
    await expect(revokeAccess(request({ organizationId: "org-p", reason: "Cortesia encerrada a pedido." }))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(mock.writes).toHaveLength(0);
  });

  it("profissional nao chama as callables de concessao, nem com segundo fator", async () => {
    await expect(grantAccess(request(grant(), { uid: "professional" }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(revokeAccess(request({ organizationId: "org-p", reason: "Cortesia encerrada a pedido." }, { uid: "professional" }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(grantAccess(request(grant(), { token: PASSWORD_ONLY }))).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.writes).toHaveLength(0);
  });

  it("so abre acesso para a conta profissional titular da organizacao", async () => {
    mock.documents.set(paths.organization("org-p"), { id: "org-p", ownerId: "admin" });
    await expect(grantAccess(request(grant()))).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(grantAccess(request(grant({ organizationId: "org-inexistente" })))).rejects.toMatchObject({ code: "not-found" });
    expect(mock.writes).toHaveLength(0);
  });
});

describe("Pontos de escrita da validade e atestado do aplicativo", () => {
  it("so o webhook e a concessao escrevem situacao e validade da conta", () => {
    // Varre o codigo do backend: um terceiro caminho, mesmo bem-intencionado,
    // quebra a regra 10 do AGENTS.md e precisa aparecer aqui.
    const writers = readdirSync(new URL(".", import.meta.url))
      .filter(name => name.endsWith(".js") && !name.endsWith(".test.js"))
      .filter(name => /\b(subscriptionStatus|accessUntil|accessUntilMs)\s*:/.test(readFileSync(new URL(name, import.meta.url), "utf8")));
    expect(writers.sort()).toEqual(["billing.js", "platform.js"]);
  });

  it("toda callable exige App Check; o webhook, que o gateway chama, nao", () => {
    const callables = ["registerProfessional", "updateAccount", "completeInitialPassword", "grantAccess", "revokeAccess", "createSubscriptionCheckout", "openBillingPortal", "cancelPlatformSubscription", "exportClientData", "eraseClientData", "startOrganizationExport", "exportOrganizationPage", "deleteOrganization"];
    for (const name of callables) expect(backend[name].options, name).toMatchObject({ enforceAppCheck: true });
    expect(backend.stripeWebhook.options.enforceAppCheck).toBeUndefined();
  });
});
