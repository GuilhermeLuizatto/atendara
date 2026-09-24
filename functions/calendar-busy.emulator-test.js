import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./kms.js", () => ({
  encryptSecret: vi.fn(async (value) => `cifrado(${value})`),
  decryptSecret: vi.fn(async () => "refresh-ficticio"),
}));

const { refreshAllCalendars } = await import("./calendar.js");
const { fromStored, toStored } = await import("./firestore-dates.js");
const { GOOGLE_CALENDAR_SCOPES } = await import("./generated/calendar-config.js");
const { paths } = await import("./generated/paths.js");

/**
 * Rotina de 30 minutos contra o emulador do Firestore (3C, frente 2).
 *
 * A consulta de grupo de coleções e as transações rodam de verdade; o Google é
 * um dublê. Prova que só conexões ativas são lidas, que o ocupado cai no tenant
 * de cada uma e que nenhum campo de evento externo é gravado.
 *
 * Rodar com: npm run test:repository
 */

const RUN = Date.now();
const ORGS = [`org-ocupado-a-${RUN}`, `org-ocupado-b-${RUN}`];
let db;

async function seed(organizationId, professionalId, userId, status) {
  await db.doc(paths.organization(organizationId)).set({ id: organizationId, ownerId: userId, primaryProfession: "PSYCHOLOGIST" });
  await db.doc(paths.account(userId)).set({
    organizationId,
    status: "ACTIVE",
    platformRole: "PROFESSIONAL",
    professionId: "PSYCHOLOGIST",
    subscriptionStatus: "ACTIVE",
    accessUntil: "2199-01-01T00:00:00Z",
    modules: ["agenda"],
    mustChangePassword: false,
  });
  await db.doc(paths.document(organizationId, "members", userId)).set({ status: "ACTIVE", role: "PROFESSIONAL" });
  await db.doc(paths.document(organizationId, "professionals", professionalId)).set({ userId, active: true });
  await db.doc(paths.document(organizationId, "calendarConnections", professionalId)).set(
    toStored("calendarConnections", {
      id: professionalId,
      organizationId,
      professionalId,
      provider: "GOOGLE",
      status,
      generation: `geracao-${professionalId}`,
      refreshTokenCiphertext: "cifrado",
      scopes: [...GOOGLE_CALENDAR_SCOPES],
      calendarId: "agenda-atendara",
      lastError: null,
    }),
  );
}

beforeAll(async () => {
  initializeApp({ projectId: "demo-atendara" });
  db = getFirestore();
  await seed(ORGS[0], "perfil-a", `usuario-a-${RUN}`, "CONNECTED");
  await seed(ORGS[1], "perfil-b", `usuario-b-${RUN}`, "REVOKED");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("3C — ocupado lido a cada 30 minutos", () => {
  it("lê só a conexão ativa e grava o ocupado no tenant dela, sem título", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url) => {
      calls.push(String(url));
      const body = String(url).includes("oauth2")
        ? { access_token: "curto" }
        : {
            calendars: {
              primary: {
                busy: [{ start: "2099-03-02T17:00:00Z", end: "2099-03-02T18:00:00Z", summary: "Particular" }],
              },
            },
          };
      return { ok: true, status: 200, json: async () => body };
    });

    const result = await refreshAllCalendars({ firestore: db, client: { clientId: "id", clientSecret: "segredo" } });
    // Pode haver conexões de outras suítes no mesmo banco; as desta contam.
    expect(result.read).toBeGreaterThanOrEqual(1);

    const busyA = await db.doc(paths.document(ORGS[0], "calendarBusyBlocks", "perfil-a")).get();
    expect(busyA.exists).toBe(true);
    const stored = fromStored("calendarBusyBlocks", busyA.id, busyA.data());
    expect(stored.blocks).toEqual([{ startsAt: "2099-03-02T17:00:00.000Z", endsAt: "2099-03-02T18:00:00.000Z" }]);
    expect(JSON.stringify(busyA.data())).not.toContain("Particular");

    const busyB = await db.doc(paths.document(ORGS[1], "calendarBusyBlocks", "perfil-b")).get();
    expect(busyB.exists).toBe(false);
  });
});
