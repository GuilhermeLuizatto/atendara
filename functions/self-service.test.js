import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Autocadastro (A.2), caso a caso.
 *
 * Mesma bancada de `index.test.js`: cada escrita guarda a origem — lote
 * (`batch`) ou transacao (`tx`) — e e assim que se prova que o ato e o registro
 * saem juntos. O que estes testes protegem, acima de tudo, e a regra 10: uma
 * chamada de cadastro nao pode abrir validade, e o teste de 14 dias so nasce
 * como concessao registrada depois do e-mail confirmado.
 */
const mock = vi.hoisted(() => ({ documents: new Map(), createUser: vi.fn(), deleteUser: vi.fn(), commit: vi.fn(), writes: [], transactions: 0 }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ createUser: mock.createUser, deleteUser: mock.deleteUser }) }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({
  doc: path => ({ path, get: async () => ({ data: () => mock.documents.get(path) }) }),
  batch: () => ({
    create: (ref, data) => mock.writes.push({ origin: "batch", op: "create", path: ref.path, data }),
    update: (ref, data) => mock.writes.push({ origin: "batch", op: "update", path: ref.path, data }),
    commit: mock.commit,
  }),
  runTransaction: async callback => {
    const origin = `tx-${++mock.transactions}`;
    const record = op => (ref, data) => mock.writes.push({ origin, op, path: ref.path, data });
    return callback({ get: ref => ref.get(), set: record("set"), update: record("update"), create: record("create") });
  },
}) }));
vi.mock("firebase-functions/v2/https", () => ({ onCall: (options, handler) => Object.assign(handler, { options }), HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }));

import { activateTrial, registerSelfService } from "./self-service.js";
import { paths } from "./generated/paths.js";
import { LEGAL_VERSION } from "./generated/legal-config.js";
import { APP_MODULES } from "./generated/access.js";
import { MAX_ACCESS_GRANT_DAYS, SELF_SERVICE_ACTOR, TRIAL_DAYS } from "./generated/platform-config.js";

const DAY = 86_400_000;
const NEW_UID = "novo";
const signup = extra => ({ displayName: "Bianca Ferraz", email: "Bianca@Exemplo.com.br", password: "Senha#DeTeste1", professionId: "AESTHETICS", businessName: "Espaço Lume", acceptedLegalVersion: LEGAL_VERSION, ...extra });
const anonymous = data => ({ data, rawRequest: { headers: { "x-forwarded-for": "203.0.113.7" }, ip: "203.0.113.7" } });
const signedIn = (data, { uid = NEW_UID, token = {} } = {}) => ({ ...anonymous(data), auth: { uid, token: { email_verified: true, email: "bianca@exemplo.com.br", ...token } } });
const writesTo = path => mock.writes.filter(write => write.path === path);
const writesUnder = prefix => mock.writes.filter(write => write.path.startsWith(prefix));
const auditWrites = () => writesUnder("platformAuditLogs/");
const grantWrites = () => writesUnder("platformAccessGrants/");
const accountWrites = () => writesTo(paths.account(NEW_UID));
const rateLimitWrites = () => writesUnder("platformRateLimits/");

beforeEach(() => {
  vi.clearAllMocks(); mock.documents.clear(); mock.writes.length = 0; mock.transactions = 0;
  mock.createUser.mockResolvedValue({ uid: NEW_UID }); mock.commit.mockResolvedValue(undefined);
});

describe("Cadastro aberto", () => {
  it("cria conta, organizacao e perfil sem nenhuma validade antes da confirmacao", async () => {
    expect(await registerSelfService(anonymous(signup()))).toEqual({ ok: true });

    const [account] = accountWrites();
    expect(account.data).toMatchObject({
      platformRole: "PROFESSIONAL", status: "ACTIVE", origin: "SELF_SERVICE",
      // Regra 10: cadastro nao abre portao. Quem abre e a concessao registrada.
      subscriptionStatus: "PENDING", accessUntil: null, accessUntilMs: 0,
      // Senha escolhida pela propria pessoa: nao ha senha inicial a trocar.
      mustChangePassword: false,
      email: "bianca@exemplo.com.br",
      legal: { version: LEGAL_VERSION },
    });
    expect(account.data.modules).toEqual([...APP_MODULES]);
    expect(grantWrites()).toHaveLength(0);
    expect(mock.writes.some(write => write.path.startsWith("initialPasswords/"))).toBe(false);

    const [organization] = writesUnder("organizations/");
    expect(organization.data).toMatchObject({ ownerId: NEW_UID, name: "Espaço Lume", primaryProfession: "AESTHETICS" });
    expect(auditWrites().map(write => write.data.action)).toEqual(["SELF_SERVICE_REGISTERED"]);
    expect(auditWrites()[0].data).toMatchObject({ actorId: SELF_SERVICE_ACTOR, targetUserId: NEW_UID, details: { signInMethod: "PASSWORD" } });
  });

  it("responde igual para e-mail novo e para e-mail ja cadastrado", async () => {
    const primeira = await registerSelfService(anonymous(signup()));
    mock.writes.length = 0;
    mock.createUser.mockRejectedValueOnce(Object.assign(new Error("ja existe"), { code: "auth/email-already-exists" }));

    const segunda = await registerSelfService(anonymous(signup()));
    expect(segunda).toEqual(primeira);
    // Nada foi escrito: a resposta identica e a unica coisa que a tela recebe.
    expect(mock.writes.filter(write => !write.path.startsWith("platformRateLimits/"))).toHaveLength(0);
  });

  it("guarda o registro do conselho de quem tem, e recusa o que nao tem forma", async () => {
    await registerSelfService(anonymous(signup({ professionId: "PSYCHOLOGIST", councilRegistration: "CRP 06/123456" })));
    const [profile] = writesUnder("organizations/").filter(write => write.path.includes("/professionals/"));
    expect(profile.data.licenseNumber).toBe("CRP 06/123456");

    mock.writes.length = 0; mock.createUser.mockClear();
    await expect(registerSelfService(anonymous(signup({ professionId: "PSYCHOLOGIST" })))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(registerSelfService(anonymous(signup({ professionId: "PSYCHOLOGIST", councilRegistration: "<script>" })))).rejects.toMatchObject({ code: "invalid-argument" });
    // Estetica nao tem conselho: mandar registro e sinal de tela fora de sincronia.
    await expect(registerSelfService(anonymous(signup({ councilRegistration: "CRP 06/123456" })))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mock.createUser).not.toHaveBeenCalled();
  });

  it("recusa profissao fora da vitrine e aceite de versao diferente", async () => {
    await expect(registerSelfService(anonymous(signup({ professionId: "THERAPIST" })))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(registerSelfService(anonymous(signup({ acceptedLegalVersion: "2020-01-01" })))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(mock.createUser).not.toHaveBeenCalled();
  });

  it("recusa validade, papel e modulos vindos do payload", async () => {
    for (const extra of [{ accessUntil: new Date().toISOString() }, { subscriptionStatus: "ACTIVE" }, { platformRole: "PLATFORM_ADMIN" }, { modules: ["agenda"] }, { origin: "OPERATOR" }]) {
      await expect(registerSelfService(anonymous(signup(extra)))).rejects.toMatchObject({ code: "invalid-argument" });
    }
    expect(mock.createUser).not.toHaveBeenCalled();
  });

  it("recusa senha curta", async () => {
    await expect(registerSelfService(anonymous(signup({ password: "1234567" })))).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("recusa senha fora da politica antes de criar o login, e diz o que falta", async () => {
    // Doze caracteres, sem maiuscula nem simbolo: o Identity Platform a
    // recusaria no primeiro login, com a conta ja criada.
    const erro = await registerSelfService(anonymous(signup({ password: "senhafraca12" }))).catch((caught) => caught);

    expect(erro).toMatchObject({ code: "invalid-argument" });
    expect(erro.message).toContain("letra maiúscula");
    expect(erro.message).toContain("símbolo");
    expect(mock.createUser).not.toHaveBeenCalled();
  });

  it("apaga a conta do Authentication quando a gravacao falha", async () => {
    mock.commit.mockRejectedValueOnce(new Error("indisponivel"));
    await expect(registerSelfService(anonymous(signup()))).rejects.toMatchObject({ code: "internal" });
    expect(mock.deleteUser).toHaveBeenCalledWith(NEW_UID);
  });

  it("conta o limite por rede antes de qualquer validacao", async () => {
    await expect(registerSelfService(anonymous({}))).rejects.toMatchObject({ code: "invalid-argument" });
    const [contador] = rateLimitWrites();
    expect(contador.path).toContain("selfServiceSignupByNetwork_rede-");
    // O endereco nunca e gravado: o contador guarda so o resumo.
    expect(JSON.stringify(contador.data)).not.toContain("203.0.113.7");
  });

  it("pelo Google comeca o teste na mesma chamada, porque o e-mail ja veio confirmado", async () => {
    await registerSelfService(signedIn(signup({ password: undefined })));

    const [grant] = grantWrites();
    expect(grant.data).toMatchObject({ kind: "TRIAL", grantedBy: SELF_SERVICE_ACTOR, subscriberUserId: NEW_UID, revokedAt: null });
    const dias = (Date.parse(grant.data.until) - Date.now()) / DAY;
    expect(dias).toBeGreaterThan(TRIAL_DAYS - 1);
    expect(dias).toBeLessThanOrEqual(TRIAL_DAYS);
    expect(TRIAL_DAYS).toBeLessThanOrEqual(MAX_ACCESS_GRANT_DAYS);

    const [account] = accountWrites();
    expect(account.data).toMatchObject({ subscriptionStatus: "ACTIVE", accessUntil: grant.data.until });
    expect(auditWrites().map(write => write.data.action)).toEqual(["SELF_SERVICE_REGISTERED", "TRIAL_STARTED"]);
    // Ato e registro no mesmo lote: nao existe concessao sem trilha.
    expect(new Set(mock.writes.filter(write => !write.path.startsWith("platformRateLimits/")).map(write => write.origin))).toEqual(new Set(["batch"]));
    expect(mock.createUser).not.toHaveBeenCalled();
  });

  it("recusa o Google sem e-mail confirmado e com e-mail diferente do informado", async () => {
    await expect(registerSelfService(signedIn(signup({ password: undefined }), { token: { email_verified: false } }))).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(registerSelfService(signedIn(signup({ email: "outra@exemplo.com.br", password: undefined })))).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("nao cadastra duas vezes a mesma conta do Google", async () => {
    mock.documents.set(paths.account(NEW_UID), { status: "ACTIVE", platformRole: "PROFESSIONAL" });
    await expect(registerSelfService(signedIn(signup({ password: undefined })))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(grantWrites()).toHaveLength(0);
  });
});

describe("Inicio do teste de 14 dias", () => {
  const cadastrada = extra => mock.documents.set(paths.account(NEW_UID), { userId: NEW_UID, status: "ACTIVE", platformRole: "PROFESSIONAL", organizationId: "org-nova", origin: "SELF_SERVICE", subscriptionStatus: "PENDING", accessUntil: null, ...extra });

  it("abre o portao so depois do e-mail confirmado, com concessao e registro juntos", async () => {
    cadastrada();
    await expect(activateTrial(signedIn({}, { token: { email_verified: false } }))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(grantWrites()).toHaveLength(0);

    const result = await activateTrial(signedIn({}));
    const [grant] = grantWrites();
    expect(grant.data).toMatchObject({ kind: "TRIAL", organizationId: "org-nova", grantedBy: SELF_SERVICE_ACTOR });
    expect(result.accessUntil).toBe(grant.data.until);

    const [account] = accountWrites();
    expect(account.data).toEqual({ subscriptionStatus: "ACTIVE", accessUntil: grant.data.until, accessUntilMs: Date.parse(grant.data.until) });
    const [audit] = auditWrites();
    expect(audit.data).toMatchObject({ action: "TRIAL_STARTED", actorId: SELF_SERVICE_ACTOR, organizationId: "org-nova" });
    // Concessao, portao e registro na MESMA transacao.
    expect(new Set([grant.origin, account.origin, audit.origin])).toHaveLength(1);
  });

  it("nao emenda um segundo teste na mesma organizacao", async () => {
    cadastrada({ subscriptionStatus: "ACTIVE", accessUntil: new Date(Date.now() + 3 * DAY).toISOString() });
    mock.documents.set(paths.platformAccessGrant("org-nova"), { kind: "TRIAL", until: new Date(Date.now() + 3 * DAY).toISOString(), revokedAt: null });

    const result = await activateTrial(signedIn({}));
    expect(result.accessUntil).toBe(mock.documents.get(paths.account(NEW_UID)).accessUntil);
    expect(grantWrites()).toHaveLength(0);
    expect(auditWrites()).toHaveLength(0);
    expect(accountWrites()).toHaveLength(0);
  });

  it("recusa quem nao entrou, quem esta suspenso e quem foi cadastrado pela operadora", async () => {
    await expect(activateTrial({ ...anonymous({}) })).rejects.toMatchObject({ code: "unauthenticated" });

    cadastrada({ status: "SUSPENDED" });
    await expect(activateTrial(signedIn({}))).rejects.toMatchObject({ code: "permission-denied" });

    cadastrada({ origin: undefined });
    await expect(activateTrial(signedIn({}))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(grantWrites()).toHaveLength(0);
  });
});
