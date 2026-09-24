import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map());
const network = vi.hoisted(() => ({ calls: [], responses: [] }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (options, handler) => Object.assign(handler, { options }),
  onRequest: (options, handler) => Object.assign(handler, { options }),
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("firebase-admin/firestore", () => {
  const snapshot = (path) => ({
    id: path.split("/").pop(),
    exists: store.has(path),
    data: () => store.get(path),
  });
  const asDate = (value) => (value && typeof value.toDate === "function" ? value.toDate() : new Date(value));
  // Consulta mínima: filhos diretos da coleção, igualdade e ">=" em data.
  const query = (path, filters = [], max = Infinity) => ({
    where: (field, op, value) => query(path, [...filters, { field, op, value }], max),
    orderBy: () => query(path, filters, max),
    limit: (count) => query(path, filters, count),
    get: async () => ({
      docs: [...store.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"))
        .filter((key) =>
          filters.every(({ field, op, value }) => {
            const actual = store.get(key)[field];
            return op === "==" ? actual === value : asDate(actual) >= asDate(value);
          }),
        )
        .slice(0, max)
        .map(snapshot),
    }),
  });
  // Grupo de coleções: qualquer `organizations/{org}/{nome}/{id}`.
  const group = (name, filters = [], after = null) => ({
    where: (field, op, value) => group(name, [...filters, { field, op, value }], after),
    orderBy: () => group(name, filters, after),
    limit: () => group(name, filters, after),
    startAfter: (document) => group(name, filters, document.ref.path),
    get: async () => ({
      docs: [...store.keys()]
        .filter((key) => key.split("/").length === 4 && key.split("/")[2] === name)
        .filter((key) => filters.every(({ field, value }) => store.get(key)[field] === value))
        .sort()
        .filter((key) => !after || key > after)
        .map((key) => ({
          ...snapshot(key),
          ref: { path: key, parent: { parent: { id: key.split("/")[1] } } },
        })),
    }),
  });
  return {
    FieldPath: { documentId: () => "__name__" },
    getFirestore: () => ({
      doc: (path) => ({ path, get: async () => snapshot(path) }),
      collection: (path) => query(path),
      collectionGroup: (name) => group(name),
      batch: () => ({
        create: (ref, data) => store.set(ref.path, data),
        commit: async () => {},
      }),
      runTransaction: async (callback) =>
        callback({
          get: async (ref) => snapshot(ref.path),
          set: (ref, data) => store.set(ref.path, data),
          delete: (ref) => store.delete(ref.path),
        }),
    }),
    Timestamp: class Timestamp {
      constructor(date) {
        this.date = date;
      }
      static fromDate(date) {
        return new Timestamp(date);
      }
      toDate() {
        return this.date;
      }
    },
  };
});
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: vi.fn(async () => {}) }));
const queued = vi.hoisted(() => []);
vi.mock("./automation.js", () => ({
  requeueTask: vi.fn(async (task) => {
    queued.push(task.id);
  }),
}));
vi.mock("./kms.js", () => ({
  encryptSecret: vi.fn(async (value) => `cipher(${value})`),
  decryptSecret: vi.fn(async (value) =>
    String(value).replace(/^cipher\((.*)\)$/, "$1"),
  ),
}));

const calendar = await import("./calendar.js");
const { paths } = await import("./generated/paths.js");
const { GOOGLE_CALENDAR_SCOPES } =
  await import("./generated/calendar-config.js");
const { fromStored } = await import("./firestore-dates.js");
const ORG = "org-calendar";
const USER = "user-owner";
const PROFILE = "profile-not-the-uid";
const SECRET = "state-secret-for-tests";
const connectionPath = paths.document(ORG, "calendarConnections", PROFILE);
const busyPath = paths.document(ORG, "calendarBusyBlocks", PROFILE);
const call = () => ({ auth: { uid: USER }, data: { professionalId: PROFILE } });
const validTokens = {
  refresh_token: "private-refresh",
  access_token: "private-access",
  scope: GOOGLE_CALENDAR_SCOPES.join(" "),
};
const freeBusy = {
  calendars: {
    primary: {
      busy: [
        {
          start: "2026-09-25T12:00:00Z",
          end: "2026-09-25T13:00:00Z",
          summary: "Private event",
          attendees: ["private@example.test"],
        },
      ],
    },
  },
};
function response() {
  return {
    code: null,
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}
async function begin() {
  return new URL(
    (await calendar.startCalendarConnection(call())).url,
  ).searchParams.get("state");
}
async function callback(state, code = "google-code") {
  const result = response();
  await calendar.googleOAuthCallback(
    { method: "GET", query: { state, code } },
    result,
  );
  return result;
}
function seedConnected() {
  store.set(connectionPath, {
    id: PROFILE,
    organizationId: ORG,
    professionalId: PROFILE,
    status: "CONNECTED",
    generation: "generation-1",
    refreshTokenCiphertext: "cipher(private-refresh)",
    scopes: GOOGLE_CALENDAR_SCOPES,
    lastError: null,
  });
}
function queueBusy(body = freeBusy) {
  network.responses.push(
    { ok: true, body: { access_token: "private-access" } },
    { ok: true, body },
  );
}
beforeEach(() => {
  store.clear();
  queued.length = 0;
  network.calls = [];
  network.responses = [];
  process.env.CALENDAR_STATE_SECRET = SECRET;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.CALENDAR_REDIRECT_URL =
    "https://example.test/googleOAuthCallback";
  process.env.CALENDAR_KMS_KEY = "test-key";
  store.set(paths.account(USER), {
    organizationId: ORG,
    status: "ACTIVE",
    platformRole: "PROFESSIONAL",
    professionId: "psychologist",
    subscriptionStatus: "ACTIVE",
    accessUntil: "2099-01-01T00:00:00Z",
    modules: ["agenda"],
    mustChangePassword: false,
  });
  store.set(paths.organization(ORG), { ownerId: USER });
  store.set(paths.document(ORG, "members", USER), {
    status: "ACTIVE",
    role: "PROFESSIONAL",
  });
  store.set(paths.document(ORG, "professionals", PROFILE), {
    userId: USER,
    active: true,
  });
  vi.stubGlobal("fetch", async (url, init) => {
    network.calls.push({ url: String(url), init });
    const next = network.responses.shift() ?? { ok: true, body: {} };
    if (next.before) await next.before();
    return {
      ok: next.ok,
      status: next.status ?? (next.ok ? 200 : 400),
      json: async () => next.body,
    };
  });
});

describe("autorização própria e estado OAuth", () => {
  it("pede livre/ocupado e a agenda própria, e identifica o perfil vinculado, mesmo com ID diferente do usuário", async () => {
    const url = new URL((await calendar.startCalendarConnection(call())).url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.app.created",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(
      calendar.readState(SECRET, url.searchParams.get("state")),
    ).toMatchObject({
      organizationId: ORG,
      professionalId: PROFILE,
      userId: USER,
    });
    expect(store.get(connectionPath).pendingOAuth.claimed).toBe(false);
  });
  it.each([
    [
      "conta vencida",
      () =>
        Object.assign(store.get(paths.account(USER)), {
          accessUntil: "2000-01-01",
        }),
    ],
    [
      "sem agenda",
      () => Object.assign(store.get(paths.account(USER)), { modules: [] }),
    ],
    [
      "troca obrigatória de senha",
      () =>
        Object.assign(store.get(paths.account(USER)), {
          mustChangePassword: true,
        }),
    ],
    [
      "operadora",
      () =>
        Object.assign(store.get(paths.account(USER)), {
          platformRole: "PLATFORM_ADMIN",
        }),
    ],
    ["sem organização", () => store.delete(paths.organization(ORG))],
    [
      "membro inativo",
      () =>
        Object.assign(store.get(paths.document(ORG, "members", USER)), {
          status: "INACTIVE",
        }),
    ],
    [
      "perfil alheio",
      () =>
        Object.assign(
          store.get(paths.document(ORG, "professionals", PROFILE)),
          { userId: "another-user" },
        ),
    ],
    [
      "outro tenant",
      () =>
        Object.assign(store.get(paths.account(USER)), {
          organizationId: "another-org",
        }),
    ],
  ])(
    "recusa %s para conectar, consultar e atualizar",
    async (_label, change) => {
      change();
      for (const handler of [
        calendar.startCalendarConnection,
        calendar.getCalendarConnection,
        calendar.refreshCalendarBusy,
      ]) {
        await expect(handler(call())).rejects.toMatchObject({
          code: "permission-denied",
        });
      }
      expect(network.calls).toHaveLength(0);
    },
  );
  it("recusa estado adulterado, futuro, vencido, incompleto, caminho e segmentos extras", async () => {
    const state = await begin();
    const payload = calendar.readState(SECRET, state);
    expect(calendar.readState("wrong", state)).toBeNull();
    expect(calendar.readState(SECRET, `${state}.extra`)).toBeNull();
    expect(
      calendar.readState(SECRET, `${state.split(".")[0]}.é`.repeat(43)),
    ).toBeNull();
    expect(calendar.readState(SECRET, state, payload.at + 600_000)).toBeNull();
    for (const patch of [
      { at: Date.now() + 60_000 },
      { nonce: undefined },
      { professionalId: "a/b" },
    ]) {
      expect(
        calendar.readState(
          SECRET,
          calendar.signState(SECRET, { ...payload, ...patch }),
        ),
      ).toBeNull();
    }
  });
});

describe("retorno Google", () => {
  it("cifra a credencial, rejeita repetição e só devolve campos públicos na consulta", async () => {
    const state = await begin();
    network.responses.push(
      { ok: true, body: validTokens },
      { ok: true, body: { id: "agenda-atendara" } },
    );
    expect((await callback(state)).code).toBe(200);
    expect(store.get(connectionPath).refreshTokenCiphertext).toBe(
      "cipher(private-refresh)",
    );
    expect(JSON.stringify([...store.values()])).not.toContain(
      '"private-refresh"',
    );
    const publicData = await calendar.getCalendarConnection(call());
    expect(publicData.status).toBe("CONNECTED");
    expect(JSON.stringify(publicData)).not.toMatch(
      /cipher|private|nonce|pendingOAuth|generation/,
    );
    expect((await callback(state)).code).toBe(400);
    expect(network.calls).toHaveLength(2);
  });
  it("cria a agenda Atendara no fuso da organização e envia os atendimentos futuros", async () => {
    store.set(paths.organization(ORG), { ownerId: USER, timezone: "America/Manaus" });
    const future = (id, overrides = {}) =>
      store.set(paths.document(ORG, "appointments", id), {
        professionalId: PROFILE,
        clientName: "Pessoa Fictícia",
        startsAt: "2099-01-10T12:00:00.000Z",
        endsAt: "2099-01-10T13:00:00.000Z",
        status: "SCHEDULED",
        ...overrides,
      });
    future("futuro");
    future("cancelado", { status: "CANCELLED" });
    future("passado", { startsAt: "2000-01-10T12:00:00.000Z" });
    future("de-outro", { professionalId: "outro-perfil" });

    const state = await begin();
    network.responses.push(
      { ok: true, body: validTokens },
      { ok: true, body: { id: "agenda-atendara" } },
    );
    expect((await callback(state)).code).toBe(200);

    const created = network.calls[1];
    expect(created.url).toBe("https://www.googleapis.com/calendar/v3/calendars");
    expect(JSON.parse(created.init.body)).toEqual({ summary: "Atendara", timeZone: "America/Manaus" });
    expect(store.get(connectionPath)).toMatchObject({
      calendarId: "agenda-atendara",
      scopes: GOOGLE_CALENDAR_SCOPES,
    });
    expect(queued).toHaveLength(1);
    const task = store.get(paths.document(ORG, "automationTasks", queued[0]));
    expect(task).toMatchObject({
      type: "SYNC_CALENDAR_EVENT",
      appointmentId: "futuro",
      professionalId: PROFILE,
      clientId: null,
    });
    const publicData = await calendar.getCalendarConnection(call());
    expect(publicData.writeEnabled).toBe(true);
    expect(JSON.stringify(publicData)).not.toContain("agenda-atendara");
  });
  it("sem a permissão da agenda própria, não conecta", async () => {
    const state = await begin();
    network.responses.push({
      ok: true,
      body: { ...validTokens, scope: "https://www.googleapis.com/auth/calendar.freebusy" },
    });
    expect((await callback(state)).code).toBe(400);
    expect(store.get(connectionPath).status).toBe("REVOKED");
  });
  it("reconectar depois de autorização caída reaproveita a agenda que ainda existe", async () => {
    seedConnected();
    Object.assign(store.get(connectionPath), { status: "ERROR", calendarId: "agenda-anterior" });
    const state = await begin();
    network.responses.push(
      { ok: true, body: validTokens },
      { ok: true, body: { id: "agenda-anterior" } },
    );
    expect((await callback(state)).code).toBe(200);
    expect(network.calls[1]).toMatchObject({
      url: "https://www.googleapis.com/calendar/v3/calendars/agenda-anterior",
      init: { method: "GET" },
    });
    expect(network.calls).toHaveLength(2);
    expect(store.get(connectionPath).calendarId).toBe("agenda-anterior");
  });
  it("sem conseguir criar a agenda, conecta só para ler e a tela pede reconexão para escrever", async () => {
    const state = await begin();
    network.responses.push({ ok: true, body: validTokens }, { ok: false, status: 500, body: {} });
    expect((await callback(state)).code).toBe(200);
    expect(store.get(connectionPath)).toMatchObject({ status: "CONNECTED", calendarId: null });
    expect((await calendar.getCalendarConnection(call())).writeEnabled).toBe(false);
    expect(queued).toHaveLength(0);
  });
  it("falha do KMS registra etapa e status, sem token nem código", async () => {
    const logger = await import("firebase-functions/logger");
    const { encryptSecret } = await import("./kms.js");
    encryptSecret.mockRejectedValueOnce(
      Object.assign(new Error("KMS recusou a operação (403)."), {
        name: "KmsError",
        status: 403,
      }),
    );
    const state = await begin();
    network.responses.push({ ok: true, body: validTokens });
    expect((await callback(state)).code).toBe(500);
    expect(logger.warn).toHaveBeenLastCalledWith("calendar.oauth.failed", {
      outcome: "PROVIDER_ERROR",
      stage: "encrypt",
      errorName: "KmsError",
      status: 403,
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(
      /private|google-code/,
    );
    expect(store.get(connectionPath).status).toBe("REVOKED");
  });
  it("recusa do Google registra só o código curto do OAuth", async () => {
    const logger = await import("firebase-functions/logger");
    const state = await begin();
    network.responses.push({
      ok: false,
      status: 401,
      body: { error: "invalid_client", error_description: "google-code eco" },
    });
    expect((await callback(state)).code).toBe(400);
    expect(logger.warn).toHaveBeenLastCalledWith("calendar.oauth.rejected", {
      status: 401,
      error: "invalid_client",
      refreshToken: false,
      scopeGranted: false,
    });
  });
  it("uma segunda tentativa invalida a primeira e cancelar consome o estado", async () => {
    const first = await begin();
    const second = await begin();
    expect((await callback(first)).code).toBe(400);
    expect((await callback(second, null)).code).toBe(400);
    expect((await callback(second)).code).toBe(400);
    expect(network.calls).toHaveLength(0);
  });
  it.each([
    { access_token: "short", scope: GOOGLE_CALENDAR_SCOPES.join(" ") },
    { refresh_token: "private-refresh", scope: "unrelated" },
    { refresh_token: "private-refresh" },
  ])("não conecta sem refresh token e escopo concedido: %j", async (body) => {
    const state = await begin();
    network.responses.push({ ok: true, body });
    expect((await callback(state)).code).toBe(400);
    expect(store.get(connectionPath).status).toBe("REVOKED");
  });
  it("perder o vínculo enquanto a troca de token está em voo impede salvar a conexão", async () => {
    const state = await begin();
    network.responses.push({
      ok: true,
      body: validTokens,
      before: () => store.delete(paths.document(ORG, "members", USER)),
    });
    expect((await callback(state)).code).toBe(400);
    expect(store.get(connectionPath).refreshTokenCiphertext).toBeUndefined();
  });
  it("desconectar durante OAuth invalida o retorno em voo", async () => {
    const state = await begin();
    network.responses.push({
      ok: true,
      body: validTokens,
      before: () => calendar.disconnectCalendar(call()),
    });
    expect((await callback(state)).code).toBe(400);
    expect(store.get(connectionPath).status).toBe("REVOKED");
    expect(store.get(connectionPath).refreshTokenCiphertext).toBeNull();
  });
});

describe("consulta manual e desconexão", () => {
  beforeEach(seedConnected);
  it("conexão anterior ao contrato atual exige nova autorização e não expõe ocupado legado", async () => {
    delete store.get(connectionPath).generation;
    store.set(busyPath, { blocks: [], readAt: new Date().toISOString() });
    expect(await calendar.getCalendarConnection(call())).toMatchObject({ status: "ERROR", lastError: "RECONNECT_REQUIRED", snapshot: null });
  });
  it("consulta só primary por 30 dias, grava faixas e não devolve tokens", async () => {
    queueBusy();
    expect(await calendar.refreshCalendarBusy(call())).toEqual({ blocks: 1 });
    const request = JSON.parse(network.calls[1].init.body);
    expect(request.items).toEqual([{ id: "primary" }]);
    expect(Date.parse(request.timeMax) - Date.parse(request.timeMin)).toBe(
      30 * 86_400_000,
    );
    expect(
      network.calls.every(({ init }) => init.signal instanceof AbortSignal),
    ).toBe(true);
    const publicData = await calendar.getCalendarConnection(call());
    expect(publicData.snapshot.blocks).toEqual([
      {
        startsAt: "2026-09-25T12:00:00.000Z",
        endsAt: "2026-09-25T13:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(publicData)).not.toMatch(
      /Private|example.test|private-access|private-refresh/,
    );
  });
  it("agenda livre é uma leitura bem-sucedida com zero intervalos", async () => {
    queueBusy({ calendars: { primary: { busy: [] } } });
    expect(await calendar.refreshCalendarBusy(call())).toEqual({ blocks: 0 });
    expect(
      (await calendar.getCalendarConnection(call())).snapshot.blocks,
    ).toEqual([]);
  });
  it.each([
    {},
    { calendars: {} },
    { calendars: { primary: { errors: [{ reason: "notFound" }], busy: [] } } },
    {
      calendars: { primary: { busy: [{ start: "invalid", end: "invalid" }] } },
    },
  ])(
    "falha parcial não vira agenda livre nem atualiza leitura anterior: %j",
    async (body) => {
      queueBusy();
      await calendar.refreshCalendarBusy(call());
      const previous = store.get(busyPath);
      queueBusy(body);
      await expect(calendar.refreshCalendarBusy(call())).rejects.toMatchObject({
        code: "unavailable",
      });
      expect(store.get(busyPath)).toEqual(previous);
      expect((await calendar.getCalendarConnection(call())).lastError).toBe(
        "UNAVAILABLE",
      );
    },
  );
  it("invalid_grant exige reconexão", async () => {
    network.responses.push({ ok: false, body: { error: "invalid_grant" } });
    await expect(calendar.refreshCalendarBusy(call())).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(store.get(connectionPath)).toMatchObject({
      status: "ERROR",
      lastError: "RECONNECT_REQUIRED",
    });
  });
  it("uma leitura atrasada não vence uma consulta mais recente", async () => {
    network.responses.push(
      { ok: true, body: { access_token: "short" } },
      {
        ok: true,
        body: freeBusy,
        before: async () => {
          queueBusy({ calendars: { primary: { busy: [] } } });
          await calendar.refreshCalendarBusy(call());
        },
      },
    );
    await expect(calendar.refreshCalendarBusy(call())).rejects.toMatchObject({
      code: "aborted",
    });
    expect(store.get(busyPath).blocks).toEqual([]);
  });
  it("desconectar durante consulta impede recolocar horários no banco", async () => {
    network.responses.push(
      { ok: true, body: { access_token: "short" } },
      {
        ok: true,
        body: freeBusy,
        before: () => calendar.disconnectCalendar(call()),
      },
    );
    await expect(calendar.refreshCalendarBusy(call())).rejects.toMatchObject({
      code: "aborted",
    });
    expect(store.has(busyPath)).toBe(false);
    expect(store.get(connectionPath).status).toBe("REVOKED");
  });
  it("remove ocupado e credencial mesmo sem Google; assinatura vencida permite desconectar", async () => {
    store.set(busyPath, { blocks: [] });
    Object.assign(store.get(paths.account(USER)), {
      accessUntil: "2000-01-01",
    });
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline with private token");
    });
    expect(await calendar.disconnectCalendar(call())).toEqual({
      status: "REVOKED",
      revokedAtGoogle: false,
      calendarDeleted: true,
    });
    expect(store.has(busyPath)).toBe(false);
    expect(store.get(connectionPath)).toMatchObject({
      refreshTokenCiphertext: null,
      pendingOAuth: null,
      pendingRead: null,
    });
  });
  it("desconectar apaga a agenda Atendara antes de revogar a credencial", async () => {
    seedConnected();
    store.get(connectionPath).calendarId = "agenda-atendara";
    network.responses.push(
      { ok: true, body: { access_token: "short" } },
      { ok: true, body: {} },
      { ok: true, body: {} },
    );
    expect(await calendar.disconnectCalendar(call())).toEqual({
      status: "REVOKED",
      revokedAtGoogle: true,
      calendarDeleted: true,
    });
    expect(network.calls.map((item) => [item.init.method, item.url])).toEqual([
      ["POST", "https://oauth2.googleapis.com/token"],
      ["DELETE", "https://www.googleapis.com/calendar/v3/calendars/agenda-atendara"],
      ["POST", "https://oauth2.googleapis.com/revoke"],
    ]);
    expect(store.get(connectionPath)).toMatchObject({ calendarId: null, refreshTokenCiphertext: null });
  });
  it("conexão anterior à escrita continua lendo ocupado, mas não escreve", async () => {
    seedConnected();
    Object.assign(store.get(connectionPath), {
      scopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
      calendarId: null,
    });
    const publicData = await calendar.getCalendarConnection(call());
    expect(publicData).toMatchObject({ status: "CONNECTED", writeEnabled: false });
  });
  it("reconectar apaga a leitura da conta anterior", async () => {
    queueBusy();
    await calendar.refreshCalendarBusy(call());
    const previous = fromStored(
      "calendarConnections",
      PROFILE,
      store.get(connectionPath),
    );
    const state = await begin();
    network.responses.push({ ok: true, body: validTokens });
    expect((await callback(state)).code).toBe(200);
    expect(store.get(connectionPath).generation).not.toBe(previous.generation);
    expect(store.has(busyPath)).toBe(false);
  });
  it("rotina de 30 minutos lê toda agenda conectada e pula quem não pode", async () => {
    seedConnected();
    // Segunda organização, com a assinatura vencida: não é lida.
    const OTHER = "org-vencida";
    const otherUser = "user-vencido";
    store.set(paths.account(otherUser), {
      ...store.get(paths.account(USER)),
      organizationId: OTHER,
      accessUntil: "2000-01-01T00:00:00Z",
    });
    store.set(paths.organization(OTHER), { ownerId: otherUser });
    store.set(paths.document(OTHER, "members", otherUser), { status: "ACTIVE", role: "PROFESSIONAL" });
    store.set(paths.document(OTHER, "professionals", "perfil-vencido"), { userId: otherUser, active: true });
    store.set(paths.document(OTHER, "calendarConnections", "perfil-vencido"), {
      ...store.get(connectionPath),
      organizationId: OTHER,
      professionalId: "perfil-vencido",
    });
    // Desconectada: nem entra na consulta.
    store.set(paths.document(OTHER, "calendarConnections", "revogada"), { status: "REVOKED" });

    queueBusy();
    const result = await calendar.refreshAllCalendars({
      client: { clientId: "id", clientSecret: "segredo" },
    });
    expect(result).toEqual({ read: 1, skipped: 1, reconnect: 0, failed: 0, configured: true });
    expect(store.get(busyPath).blocks).toHaveLength(1);
    expect(JSON.stringify(store.get(busyPath))).not.toMatch(/Private event|private@example/);
    expect(store.has(paths.document(OTHER, "calendarBusyBlocks", "perfil-vencido"))).toBe(false);
  });
  it("rotina: autorização revogada põe a conexão em reconexão sem apagar a leitura anterior", async () => {
    seedConnected();
    queueBusy();
    await calendar.refreshCalendarBusy(call());
    const before = store.get(busyPath);
    network.responses.push({ ok: false, status: 400, body: { error: "invalid_grant" } });
    const result = await calendar.refreshAllCalendars({
      client: { clientId: "id", clientSecret: "segredo" },
    });
    expect(result).toMatchObject({ read: 0, reconnect: 1 });
    expect(store.get(connectionPath)).toMatchObject({ status: "ERROR", lastError: "RECONNECT_REQUIRED" });
    expect(store.get(busyPath)).toBe(before);
  });
  it("rotina sem configuração não chama o Google", async () => {
    seedConnected();
    expect(await calendar.refreshAllCalendars({ client: null })).toMatchObject({ configured: false });
    expect(network.calls).toHaveLength(0);
  });
  it("rota legada não aceita ocupado sem pedido correlacionado", async () => {
    const result = response();
    await calendar.calendarBusyCallback({}, result);
    expect(result.code).toBe(410);
    expect(store.has(busyPath)).toBe(false);
  });
});
