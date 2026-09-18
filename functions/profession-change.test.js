import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Troca de profissao, caso a caso.
 *
 * O que estes testes protegem: enquanto nao houver aprovacao, a profissao nao
 * muda — nem na conta, nem na organizacao, nem no perfil. E a decisao, quando
 * vem, sai com o registro na mesma transacao.
 */
const mock = vi.hoisted(() => ({ documents: new Map(), writes: [], transactions: 0 }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({
  doc: path => ({ path, get: async () => ({ data: () => mock.documents.get(path) }) }),
  runTransaction: async callback => {
    const origin = `tx-${++mock.transactions}`;
    const record = op => (ref, data) => mock.writes.push({ origin, op, path: ref.path, data });
    return callback({ get: ref => ref.get(), set: record("set"), update: record("update"), create: record("create") });
  },
}) }));
vi.mock("firebase-functions/v2/https", () => ({ onCall: (options, handler) => Object.assign(handler, { options }), HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }));

import { decideProfessionChange, requestProfessionChange } from "./profession-change.js";
import { paths } from "./generated/paths.js";

const TITULAR = "titular";
const ORG = "org-titular";
const TOTP = { firebase: { sign_in_provider: "password", sign_in_second_factor: "totp" } };
const MOTIVO = "Mudei de area e hoje atendo estetica, nao mais fisioterapia.";

const request = (data, { uid = TITULAR, token = {} } = {}) => ({ auth: { uid, token: { auth_time: Date.now() / 1000, ...token } }, data });
const writesTo = path => mock.writes.filter(write => write.path === path);
const auditWrites = () => mock.writes.filter(write => write.path.startsWith("platformAuditLogs/"));
const pedidoPath = paths.platformProfessionRequest(ORG);

const pedidoPendente = (extra = {}) => mock.documents.set(pedidoPath, {
  organizationId: ORG, requestedBy: TITULAR, from: "PHYSIOTHERAPIST", to: "AESTHETICS",
  reason: MOTIVO, status: "PENDING", requestedAt: "2026-09-16T10:00:00.000Z",
  decidedAt: null, decidedBy: null, decisionReason: null, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks(); mock.documents.clear(); mock.writes.length = 0; mock.transactions = 0;
  mock.documents.set(paths.account(TITULAR), { userId: TITULAR, status: "ACTIVE", platformRole: "PROFESSIONAL", organizationId: ORG, professionId: "PHYSIOTHERAPIST", mustChangePassword: false });
  mock.documents.set(paths.account("operadora"), { status: "ACTIVE", platformRole: "PLATFORM_ADMIN", mustChangePassword: false });
  mock.documents.set(paths.account("colega"), { userId: "colega", status: "ACTIVE", platformRole: "PROFESSIONAL", organizationId: ORG, professionId: "PHYSIOTHERAPIST", mustChangePassword: false });
  mock.documents.set(paths.organization(ORG), { id: ORG, ownerId: TITULAR, primaryProfession: "PHYSIOTHERAPIST" });
  mock.documents.set(paths.document(ORG, "professionals", TITULAR), { id: TITULAR, profession: "PHYSIOTHERAPIST", licenseNumber: "CREFITO 3/12345" });
});

describe("Pedido de troca de profissao", () => {
  it("guarda o pedido pendente, com registro, sem tocar na profissao", async () => {
    await requestProfessionChange(request({ professionId: "AESTHETICS", reason: MOTIVO }));

    const [pedido] = writesTo(pedidoPath);
    expect(pedido.data).toMatchObject({ from: "PHYSIOTHERAPIST", to: "AESTHETICS", status: "PENDING", requestedBy: TITULAR, decidedAt: null });
    // Nada mudou ainda: nem conta, nem organizacao, nem perfil.
    expect(writesTo(paths.account(TITULAR))).toHaveLength(0);
    expect(writesTo(paths.organization(ORG))).toHaveLength(0);
    expect(auditWrites()[0].data).toMatchObject({ action: "PROFESSION_CHANGE_REQUESTED", targetUserId: TITULAR });
    expect(auditWrites()[0].origin).toBe(pedido.origin);
  });

  it("so o titular pede, e nao para a profissao que ja tem nem para uma escondida", async () => {
    await expect(requestProfessionChange({ data: {} })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(requestProfessionChange(request({ professionId: "AESTHETICS", reason: MOTIVO }, { uid: "colega" }))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(requestProfessionChange(request({ professionId: "PHYSIOTHERAPIST", reason: MOTIVO }))).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(requestProfessionChange(request({ professionId: "THERAPIST", reason: MOTIVO }))).rejects.toMatchObject({ code: "invalid-argument" });
    // Justificativa curta demais nao explica nada a quem ler a trilha depois.
    await expect(requestProfessionChange(request({ professionId: "AESTHETICS", reason: "mudei" }))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mock.writes.filter(write => !write.path.startsWith("platformRateLimits/"))).toHaveLength(0);
  });

  it("nao acumula dois pedidos abertos", async () => {
    pedidoPendente();
    await expect(requestProfessionChange(request({ professionId: "AESTHETICS", reason: MOTIVO }))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(writesTo(pedidoPath)).toHaveLength(0);
  });

  it("deixa pedir de novo depois de uma recusa", async () => {
    pedidoPendente({ status: "REJECTED" });
    await requestProfessionChange(request({ professionId: "AESTHETICS", reason: MOTIVO }));
    expect(writesTo(pedidoPath)[0].data.status).toBe("PENDING");
  });
});

describe("Decisao da operadora", () => {
  const decisao = (extra = {}) => ({ organizationId: ORG, decision: "APPROVED", reason: "Conferi o registro e a atividade declarada.", ...extra });

  it("exige a operadora com segundo fator", async () => {
    pedidoPendente();
    await expect(decideProfessionChange(request(decisao()))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(decideProfessionChange(request(decisao(), { uid: "operadora" }))).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.writes).toHaveLength(0);
  });

  it("aprovar muda conta, organizacao e perfil na mesma transacao do registro", async () => {
    pedidoPendente();
    await decideProfessionChange(request(decisao(), { uid: "operadora", token: TOTP }));

    expect(writesTo(paths.account(TITULAR))[0].data).toEqual({ professionId: "AESTHETICS" });
    expect(writesTo(paths.organization(ORG))[0].data).toMatchObject({ primaryProfession: "AESTHETICS", professions: ["AESTHETICS"] });
    // O registro no conselho anterior nao vale para a profissao nova.
    expect(writesTo(paths.document(ORG, "professionals", TITULAR))[0].data).toMatchObject({ profession: "AESTHETICS", licenseNumber: null });
    expect(writesTo(pedidoPath)[0].data).toMatchObject({ status: "APPROVED", decidedBy: "operadora" });

    const [audit] = auditWrites();
    expect(audit.data).toMatchObject({ action: "PROFESSION_CHANGE_APPROVED", actorId: "operadora", targetUserId: TITULAR, details: { from: "PHYSIOTHERAPIST", to: "AESTHETICS" } });
    expect(new Set(mock.writes.map(write => write.origin))).toHaveLength(1);
  });

  it("recusar so fecha o pedido, e registra o motivo", async () => {
    pedidoPendente();
    await decideProfessionChange(request(decisao({ decision: "REJECTED", reason: "O registro informado e de outra profissao." }), { uid: "operadora", token: TOTP }));

    expect(writesTo(pedidoPath)[0].data).toMatchObject({ status: "REJECTED", decisionReason: "O registro informado e de outra profissao." });
    expect(writesTo(paths.account(TITULAR))).toHaveLength(0);
    expect(writesTo(paths.organization(ORG))).toHaveLength(0);
    expect(auditWrites()[0].data.action).toBe("PROFESSION_CHANGE_REJECTED");
  });

  it("recusa decidir o que nao esta pendente", async () => {
    await expect(decideProfessionChange(request(decisao(), { uid: "operadora", token: TOTP }))).rejects.toMatchObject({ code: "failed-precondition" });
    pedidoPendente({ status: "APPROVED" });
    await expect(decideProfessionChange(request(decisao(), { uid: "operadora", token: TOTP }))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(mock.writes).toHaveLength(0);
  });
});
