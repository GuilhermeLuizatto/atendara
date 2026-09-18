import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A.8: quem a limpeza de cadastro nao confirmado escolhe — e, acima de tudo,
 * quem ela nao escolhe. O apagamento em si e o `eraseOrganization`, que tem
 * suite propria contra o emulador (`privacy-rights.access-test.ts`).
 */
const mock = vi.hoisted(() => ({
  paginas: [],
  documentos: new Map(),
  writes: [],
  apagarLogin: vi.fn(),
  apagarOrganizacao: vi.fn(),
  listar: vi.fn(),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ listUsers: (...args) => mock.listar(...args), deleteUser: (...args) => mock.apagarLogin(...args) }),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    doc: (path) => ({ path, get: async () => ({ data: () => mock.documentos.get(path) }) }),
    batch: () => ({
      create: (ref, data) => mock.writes.push({ path: ref.path, data }),
      commit: async () => undefined,
    }),
  }),
}));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("./privacy.js", () => ({ eraseOrganization: (...args) => mock.apagarOrganizacao(...args) }));
vi.mock("firebase-functions/v2/scheduler", () => ({ onSchedule: (options, handler) => Object.assign(handler, { options }) }));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (options, handler) => Object.assign(handler, { options }),
  HttpsError: class extends Error {},
}));

import { CLEANUP_BATCH, eraseUnconfirmedSignups, eraseUnconfirmedSignupsDaily } from "./signup-cleanup.js";
import { paths } from "./generated/paths.js";
import { SELF_SERVICE_ACTOR, UNCONFIRMED_SIGNUP_RETENTION_DAYS } from "./generated/platform-config.js";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-10-01T07:00:00.000Z");
const criadoHa = (dias) => new Date(NOW - dias * DAY_MS).toUTCString();

const login = (uid, { dias = 8, emailVerified = false } = {}) => ({ uid, emailVerified, metadata: { creationTime: criadoHa(dias) } });

/** Conta do cadastro aberto por senha, como o `registerSelfService` grava antes da confirmacao. */
function cadastroPorSenha(uid, extra = {}) {
  const organizationId = `org-${uid}`;
  mock.documentos.set(paths.account(uid), {
    userId: uid,
    organizationId,
    platformRole: "PROFESSIONAL",
    origin: "SELF_SERVICE",
    subscriptionStatus: "PENDING",
    accessUntil: null,
    subscribedAt: null,
    ...extra,
  });
  mock.documentos.set(paths.organization(organizationId), { id: organizationId, ownerId: uid });
  return organizationId;
}

const auditoria = () => mock.writes.filter((write) => write.path.startsWith("platformAuditLogs/"));

beforeEach(() => {
  vi.clearAllMocks();
  mock.documentos.clear();
  mock.writes = [];
  mock.paginas = [];
  mock.listar.mockImplementation(async (_max, token) => {
    const index = token ? Number(token) : 0;
    return { users: mock.paginas[index] ?? [], pageToken: index + 1 < mock.paginas.length ? String(index + 1) : undefined };
  });
  mock.apagarLogin.mockResolvedValue(undefined);
  mock.apagarOrganizacao.mockResolvedValue({ requestId: "pedido", counts: {} });
});

describe("login sem cadastro — Google parado antes da segunda tela", () => {
  it("apaga o login depois de sete dias e deixa registro sem dado pessoal", async () => {
    mock.paginas = [[login("google-parado")]];

    expect(await eraseUnconfirmedSignups(NOW)).toEqual({ orphans: 1, erased: 0 });
    expect(mock.apagarLogin).toHaveBeenCalledWith("google-parado");
    expect(auditoria()).toHaveLength(1);
    expect(auditoria()[0].data).toMatchObject({
      action: "ORPHAN_LOGIN_REMOVED",
      actorId: SELF_SERVICE_ACTOR,
      organizationId: null,
      targetUserId: "google-parado",
      details: { retentionDays: UNCONFIRMED_SIGNUP_RETENTION_DAYS },
    });
  });

  it("nao toca no login com menos de sete dias", async () => {
    mock.paginas = [[login("google-recente", { dias: 6.9 })]];

    expect(await eraseUnconfirmedSignups(NOW)).toEqual({ orphans: 0, erased: 0 });
    expect(mock.apagarLogin).not.toHaveBeenCalled();
    expect(mock.writes).toHaveLength(0);
  });

  it("login que ja tinha sumido conta como removido, sem derrubar a rodada", async () => {
    mock.paginas = [[login("sumiu")]];
    mock.apagarLogin.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "auth/user-not-found" }));

    expect(await eraseUnconfirmedSignups(NOW)).toEqual({ orphans: 1, erased: 0 });
    expect(auditoria()).toHaveLength(1);
  });
});

describe("cadastro por senha sem e-mail confirmado", () => {
  it("apaga pelo mesmo apagamento da exclusao de organizacao", async () => {
    const organizationId = cadastroPorSenha("senha-parada");
    mock.paginas = [[login("senha-parada")]];

    expect(await eraseUnconfirmedSignups(NOW)).toEqual({ orphans: 0, erased: 1 });
    expect(mock.apagarOrganizacao).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        subscription: null,
        actorId: SELF_SERVICE_ACTOR,
        action: "UNCONFIRMED_SIGNUP_ERASED",
        lastAccountUserId: "senha-parada",
      }),
    );
    // O login sai dentro do `eraseOrganization`, junto da conta; nao por aqui.
    expect(mock.apagarLogin).not.toHaveBeenCalled();
  });

  it.each([
    ["confirmou o e-mail", { emailVerified: true }, {}],
    ["foi criado pela operadora", {}, { origin: undefined }],
    ["ja teve validade", {}, { accessUntil: "2026-09-20T12:00:00.000Z" }],
    ["ja assinou", {}, { subscribedAt: "2026-09-20T12:00:00.000Z" }],
    ["e administrador da plataforma", {}, { platformRole: "PLATFORM_ADMIN" }],
    ["tem menos de sete dias", { dias: 6 }, {}],
  ])("nao apaga quem %s", async (_caso, doLogin, daConta) => {
    cadastroPorSenha("protegido", daConta);
    mock.paginas = [[login("protegido", doLogin)]];

    expect(await eraseUnconfirmedSignups(NOW)).toEqual({ orphans: 0, erased: 0 });
    expect(mock.apagarOrganizacao).not.toHaveBeenCalled();
    expect(mock.apagarLogin).not.toHaveBeenCalled();
  });

  it.each([
    ["concessao registrada", (org) => paths.platformAccessGrant(org), { kind: "TRIAL" }],
    ["assinatura registrada", (org) => paths.platformSubscription(org), { status: "CANCELED" }],
    ["organizacao ja apagada", (org) => paths.organization(org), { deletion: { status: "DONE" } }],
  ])("nao apaga organizacao com %s", async (_caso, caminho, documento) => {
    const organizationId = cadastroPorSenha("com-registro");
    mock.documentos.set(caminho(organizationId), documento);
    mock.paginas = [[login("com-registro")]];

    expect(await eraseUnconfirmedSignups(NOW)).toEqual({ orphans: 0, erased: 0 });
    expect(mock.apagarOrganizacao).not.toHaveBeenCalled();
  });
});

describe("rodada", () => {
  it("percorre todas as paginas do Authentication", async () => {
    mock.paginas = [[login("pagina-1")], [login("pagina-2")]];

    expect(await eraseUnconfirmedSignups(NOW)).toEqual({ orphans: 2, erased: 0 });
    expect(mock.listar).toHaveBeenCalledTimes(2);
  });

  it("para no teto e deixa o resto para o dia seguinte", async () => {
    mock.paginas = [Array.from({ length: CLEANUP_BATCH + 5 }, (_, i) => login(`orfao-${i}`))];

    expect(await eraseUnconfirmedSignups(NOW)).toEqual({ orphans: CLEANUP_BATCH, erased: 0 });
  });

  it("uma falha nao impede os outros", async () => {
    mock.paginas = [[login("falha"), login("segue")]];
    mock.apagarLogin.mockRejectedValueOnce(new Error("indisponivel"));

    expect(await eraseUnconfirmedSignups(NOW)).toEqual({ orphans: 1, erased: 0 });
    expect(auditoria().map((write) => write.data.targetUserId)).toEqual(["segue"]);
  });

  it("roda de madrugada em Sao Paulo, depois do apagamento da A.5", () => {
    expect(eraseUnconfirmedSignupsDaily.options).toMatchObject({
      schedule: "45 4 * * *",
      timeZone: "America/Sao_Paulo",
      maxInstances: 1,
      serviceAccount: "fn-privacidade@",
    });
  });
});
