import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("./kms.js", () => ({
  encryptSecret: async () => "ciphertext",
  decryptSecret: async () => "test-refresh",
}));
vi.mock("firebase-functions/v2/https", async (original) => ({
  ...(await original()),
  onRequest: (_options, handler) => handler,
}));
const {
  startCalendarConnection,
  googleOAuthCallback,
  disconnectCalendar,
  refreshCalendarBusy,
} = await import("./calendar.js");
const { paths } = await import("./generated/paths.js");
const { GOOGLE_CALENDAR_SCOPES } =
  await import("./generated/calendar-config.js");
const ORG = `calendar-integration-${Date.now()}`;
const USER = `${ORG}-user`;
const PROFILE = "own-profile";
const request = () => ({
  auth: { uid: USER },
  data: { professionalId: PROFILE },
});
let app;
let db;
const ref = (collection) => db.doc(paths.document(ORG, collection, PROFILE));
const response = () => ({
  statusCode: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  send() {
    return this;
  },
});
async function begin() {
  return new URL(
    (await startCalendarConnection.run(request())).url,
  ).searchParams.get("state");
}
async function complete(state) {
  const result = response();
  await googleOAuthCallback(
    { method: "GET", query: { state, code: "test-code" } },
    result,
  );
  return result.statusCode;
}
beforeAll(async () => {
  app = initializeApp({ projectId: "demo-atendara" });
  db = getFirestore();
  process.env.CALENDAR_STATE_SECRET = "test-state-secret";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
  process.env.CALENDAR_REDIRECT_URL = "https://example.test/callback";
  process.env.CALENDAR_KMS_KEY = "test-key";
  await db
    .doc(paths.account(USER))
    .set({
      organizationId: ORG,
      platformRole: "PROFESSIONAL",
      status: "ACTIVE",
      professionId: "psychologist",
      subscriptionStatus: "ACTIVE",
      accessUntil: "2099-01-01T00:00:00Z",
      modules: ["agenda"],
    });
  await db.doc(paths.organization(ORG)).set({ ownerId: USER });
  await db
    .doc(paths.document(ORG, "professionals", PROFILE))
    .set({ userId: USER, active: true });
  await db
    .doc(paths.document(ORG, "members", USER))
    .set({ status: "ACTIVE", role: "PROFESSIONAL" });
});
beforeEach(async () => {
  await ref("calendarConnections").delete();
  await ref("calendarBusyBlocks").delete();
  await db.doc(paths.platformRateLimit(`calendarConnection_${USER}`)).delete();
  await db.doc(paths.platformRateLimit(`calendarDisconnect_${USER}`)).delete();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.recursiveDelete(db.doc(paths.organization(ORG)));
  await db.doc(paths.account(USER)).delete();
  await db.doc(paths.platformRateLimit(`calendarConnection_${USER}`)).delete();
  await db.doc(paths.platformRateLimit(`calendarDisconnect_${USER}`)).delete();
  await deleteApp(app);
});

describe("Calendar com transações reais do Firestore", () => {
  it("retornos simultâneos consomem o nonce uma única vez", async () => {
    const state = await begin();
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        refresh_token: "test-refresh",
        scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      }),
    }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await Promise.all([complete(state), complete(state)])).sort(),
    ).toEqual([200, 400]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await ref("calendarConnections").get()).data()).toMatchObject({
      status: "CONNECTED",
      pendingOAuth: null,
      refreshTokenCiphertext: "ciphertext",
    });
  });
  it("desconexão durante a troca OAuth vence o retorno tardio", async () => {
    const state = await begin();
    vi.stubGlobal("fetch", async () => {
      await disconnectCalendar.run(request());
      return {
        ok: true,
        json: async () => ({
          refresh_token: "test-refresh",
          scope: GOOGLE_CALENDAR_SCOPES.join(" "),
        }),
      };
    });
    expect(await complete(state)).toBe(400);
    expect((await ref("calendarConnections").get()).data()).toMatchObject({
      status: "REVOKED",
      pendingOAuth: null,
      refreshTokenCiphertext: null,
    });
  });
  it("consulta em voo não repõe ocupado depois da desconexão", async () => {
    await ref("calendarConnections").set({
      status: "CONNECTED",
      generation: "test-generation",
      refreshTokenCiphertext: "ciphertext",
    });
    vi.stubGlobal("fetch", async (url) => {
      if (url.endsWith("/token"))
        return {
          ok: true,
          json: async () => ({ access_token: "test-access" }),
        };
      if (url.endsWith("/revoke")) return { ok: true };
      await disconnectCalendar.run(request());
      return {
        ok: true,
        status: 200,
        json: async () => ({ calendars: { primary: { busy: [] } } }),
      };
    });
    await expect(refreshCalendarBusy.run(request())).rejects.toMatchObject({
      code: "aborted",
    });
    expect((await ref("calendarBusyBlocks").get()).exists).toBe(false);
    expect((await ref("calendarConnections").get()).data().status).toBe(
      "REVOKED",
    );
  });
});
