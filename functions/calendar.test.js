import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A conexao com a agenda externa (13.7), sem emulador e sem rede.
 *
 * O que estes testes protegem: o token de atualizacao nunca sai em resposta,
 * `code` devolvido por outra pessoa nao vira conexao de ninguem, desconectar
 * apaga o material cifrado mesmo quando o Google falha, e o que volta do Google
 * entra so como faixa de tempo.
 */

const store = vi.hoisted(() => new Map());
const rede = vi.hoisted(() => ({ calls: [], responses: [] }));

vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
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
  const snapshot = (path) => ({ id: path.split("/").pop(), exists: store.has(path), data: () => store.get(path) });
  return {
    getFirestore: () => ({
      doc: (path) => ({
        path,
        get: async () => snapshot(path),
        set: async (data) => store.set(path, data),
      }),
      runTransaction: async (callback) =>
        callback({
          get: async (ref) => snapshot(ref.path),
          set: (ref, data) => store.set(ref.path, data),
          create: (ref, data) => store.set(ref.path, data),
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
      toMillis() {
        return this.date.getTime();
      }
    },
  };
});
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: vi.fn(async () => {}) }));
vi.mock("./kms.js", () => ({
  encryptSecret: vi.fn(async (texto) => `cifrado(${texto})`),
  decryptSecret: vi.fn(async (texto) => String(texto).replace(/^cifrado\((.*)\)$/, "$1")),
}));

const calendario = await import("./calendar.js");
const { paths } = await import("./generated/paths.js");
const { BRIDGE_SIGNATURE_HEADER, BRIDGE_TIMESTAMP_HEADER } = await import("./generated/automation-bridge.js");
const { signBridgeMessage } = await import("./n8n-bridge.js");

const ORG = "org-clinica";
const PROFISSIONAL = "profissional-1";
const ESTADO = "segredo-do-estado";
const PONTE = "segredo-da-ponte";

beforeEach(() => {
  store.clear();
  rede.calls = [];
  rede.responses = [];
  process.env.CALENDAR_STATE_SECRET = ESTADO;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "segredo-do-app";
  process.env.GOOGLE_OAUTH_CLIENT_ID = "id-do-app.apps.googleusercontent.com";
  process.env.CALENDAR_REDIRECT_URL = "https://southamerica-east1-atendo-a3481.cloudfunctions.net/googleOAuthCallback";
  process.env.N8N_CALLBACK_SECRET = PONTE;
  store.set(paths.account(PROFISSIONAL), { id: PROFISSIONAL, organizationId: ORG, status: "ACTIVE" });
  vi.stubGlobal("fetch", async (url, init) => {
    rede.calls.push({ url: String(url), init });
    const resposta = rede.responses.shift() ?? { ok: true, body: {} };
    return { ok: resposta.ok, status: resposta.ok ? 200 : 400, json: async () => resposta.body, text: async () => "" };
  });
});

function chamada(uid, data) {
  return { auth: { uid, token: { firebase: { sign_in_provider: "password" } } }, data };
}

function resposta() {
  const enviado = { status: null, body: null };
  return {
    enviado,
    status(code) {
      enviado.status = code;
      return this;
    },
    send(body) {
      enviado.body = body;
      return this;
    },
    json(body) {
      enviado.body = body;
      return this;
    },
  };
}

describe("pedir para conectar", () => {
  it("devolve o endereco do Google com os escopos minimos e o estado assinado", async () => {
    const { url } = await calendario.startCalendarConnection(chamada(PROFISSIONAL, { professionalId: PROFISSIONAL }));
    const endereco = new URL(url);

    expect(endereco.origin + endereco.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(endereco.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.freebusy",
    );
    expect(endereco.searchParams.get("access_type")).toBe("offline");
    expect(calendario.readState(ESTADO, endereco.searchParams.get("state"))).toMatchObject({
      organizationId: ORG,
      professionalId: PROFISSIONAL,
    });
  });

  it("ninguem conecta a agenda de outra pessoa", async () => {
    await expect(
      calendario.startCalendarConnection(chamada(PROFISSIONAL, { professionalId: "outra-pessoa" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("estado assinado vence, e estado adulterado nao vale", () => {
    const estado = calendario.signState(ESTADO, { organizationId: ORG, professionalId: PROFISSIONAL, at: Date.now() });

    expect(calendario.readState(ESTADO, estado)).toBeTruthy();
    expect(calendario.readState("outro-segredo", estado)).toBeNull();
    expect(calendario.readState(ESTADO, estado, Date.now() + 20 * 60_000)).toBeNull();
    expect(calendario.readState(ESTADO, `${estado}x`)).toBeNull();
    expect(calendario.readState(ESTADO, undefined)).toBeNull();
  });
});

describe("a volta do Google", () => {
  function pedido(query) {
    return { method: "GET", query };
  }

  it("code com estado valido vira conexao, com o token cifrado — e so cifrado", async () => {
    const estado = calendario.signState(ESTADO, { organizationId: ORG, professionalId: PROFISSIONAL, at: Date.now() });
    rede.responses = [{ ok: true, body: { refresh_token: "token-de-atualizacao", access_token: "curto" } }];
    const res = resposta();

    await calendario.googleOAuthCallback(pedido({ state: estado, code: "codigo-do-google" }), res);

    expect(res.enviado.status).toBe(200);
    const conexao = store.get(paths.document(ORG, "calendarConnections", PROFISSIONAL));
    expect(conexao.status).toBe("CONNECTED");
    expect(conexao.refreshTokenCiphertext).toBe("cifrado(token-de-atualizacao)");
    // O valor claro nao foi gravado em lugar nenhum.
    expect(JSON.stringify([...store.values()])).not.toContain('"token-de-atualizacao"');
  });

  it("estado invalido nao vira conexao de ninguem", async () => {
    const res = resposta();
    await calendario.googleOAuthCallback(pedido({ state: "forjado", code: "codigo" }), res);

    expect(res.enviado.status).toBe(400);
    expect(store.get(paths.document(ORG, "calendarConnections", PROFISSIONAL))).toBeUndefined();
  });

  it("sem token de atualizacao nao ha conexao: uma hora de agenda e um silencio depois", async () => {
    const estado = calendario.signState(ESTADO, { organizationId: ORG, professionalId: PROFISSIONAL, at: Date.now() });
    rede.responses = [{ ok: true, body: { access_token: "curto" } }];
    const res = resposta();

    await calendario.googleOAuthCallback(pedido({ state: estado, code: "codigo" }), res);

    expect(res.enviado.status).toBe(400);
    expect(store.get(paths.document(ORG, "calendarConnections", PROFISSIONAL))).toBeUndefined();
  });
});

describe("desconectar", () => {
  beforeEach(() => {
    store.set(paths.document(ORG, "calendarConnections", PROFISSIONAL), {
      id: PROFISSIONAL,
      organizationId: ORG,
      professionalId: PROFISSIONAL,
      provider: "GOOGLE",
      status: "CONNECTED",
      refreshTokenCiphertext: "cifrado(token-de-atualizacao)",
      scopes: [],
      calendarId: "agenda-atendara",
      lastSyncAt: null,
      lastError: null,
    });
  });

  it("revoga no Google e apaga o material cifrado", async () => {
    await calendario.disconnectCalendar(chamada(PROFISSIONAL, { professionalId: PROFISSIONAL }));

    const conexao = store.get(paths.document(ORG, "calendarConnections", PROFISSIONAL));
    expect(conexao.status).toBe("REVOKED");
    expect(conexao.refreshTokenCiphertext).toBeNull();
    expect(conexao.calendarId).toBeNull();
    expect(rede.calls.some((call) => call.url.includes("oauth2.googleapis.com/revoke"))).toBe(true);
  });

  it("Google fora do ar nao impede o apagamento — o que nao pode sobrar e o material", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });

    await calendario.disconnectCalendar(chamada(PROFISSIONAL, { professionalId: PROFISSIONAL }));

    expect(store.get(paths.document(ORG, "calendarConnections", PROFISSIONAL)).refreshTokenCiphertext).toBeNull();
  });

  it("ninguem desconecta a agenda de outra pessoa", async () => {
    await expect(
      calendario.disconnectCalendar(chamada(PROFISSIONAL, { professionalId: "outra-pessoa" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("o ocupado que volta pelo n8n", () => {
  function pedido(corpo, { secret = PONTE, timestamp = new Date().toISOString() } = {}) {
    const headers = {
      [BRIDGE_TIMESTAMP_HEADER]: timestamp,
      [BRIDGE_SIGNATURE_HEADER]: signBridgeMessage(secret, timestamp, corpo),
    };
    return { method: "POST", rawBody: Buffer.from(corpo, "utf8"), get: (nome) => headers[nome.toLowerCase()] };
  }

  const corpo = JSON.stringify({
    organizationId: ORG,
    professionalId: PROFISSIONAL,
    freeBusy: {
      calendars: {
        primary: {
          busy: [{ start: "2026-09-25T12:00:00Z", end: "2026-09-25T13:00:00Z", summary: "Dentista", attendees: ["x@y.com"] }],
        },
      },
    },
  });

  it("grava so faixa de tempo: titulo e convidado nao entram", async () => {
    const res = resposta();
    await calendario.calendarBusyCallback(pedido(corpo), res);

    expect(res.enviado).toMatchObject({ status: 200, body: { blocks: 1 } });
    const gravado = store.get(paths.document(ORG, "calendarBusyBlocks", PROFISSIONAL));
    expect(gravado.blocks).toHaveLength(1);
    expect(JSON.stringify(gravado)).not.toContain("Dentista");
    expect(JSON.stringify(gravado)).not.toContain("y.com");
  });

  it("sem a assinatura do n8n nao grava nada", async () => {
    const res = resposta();
    await calendario.calendarBusyCallback(pedido(corpo, { secret: "errado" }), res);

    expect(res.enviado.status).toBe(401);
    expect(store.get(paths.document(ORG, "calendarBusyBlocks", PROFISSIONAL))).toBeUndefined();
  });

  it("corpo sem organizacao ou sem profissional e recusado", async () => {
    const res = resposta();
    await calendario.calendarBusyCallback(pedido(JSON.stringify({ freeBusy: {} })), res);
    expect(res.enviado.status).toBe(400);
  });
});
