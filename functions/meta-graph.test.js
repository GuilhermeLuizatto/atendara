import { beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({ calls: [], responses: [] }));

vi.mock("firebase-functions/v2/https", () => ({
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

const meta = await import("./meta-graph.js");

beforeEach(() => {
  rede.calls = [];
  rede.responses = [];
});

function fetchFake(url, init) {
  rede.calls.push({ url: String(url), init });
  const response = rede.responses.shift() ?? { ok: true, status: 200, body: {} };
  return Promise.resolve({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  });
}

describe("cliente interno da Graph API da Meta", () => {
  it("troca o código no backend sem colocar o segredo na URL", async () => {
    rede.responses = [{ ok: true, status: 200, body: { access_token: "token-do-cliente", token_type: "bearer" } }];

    const result = await meta.exchangeEmbeddedSignupCode({
      code: "codigo-unico",
      appId: "app-123",
      appSecret: "segredo-do-app",
      graphVersion: "v25.0",
      fetchImpl: fetchFake,
    });

    expect(result).toEqual({ accessToken: "token-do-cliente", tokenType: "bearer", expiresIn: null });
    expect(rede.calls[0].url).toBe("https://graph.facebook.com/v25.0/oauth/access_token");
    expect(rede.calls[0].init.body).toContain("client_id=app-123");
    expect(rede.calls[0].init.body).toContain("code=codigo-unico");
    expect(rede.calls[0].init.body).toContain("client_secret=segredo-do-app");
    expect(rede.calls[0].url).not.toContain("segredo-do-app");
  });

  it("recusa uma troca sem token e não vaza a resposta da Meta", async () => {
    rede.responses = [{ ok: false, status: 400, body: { error: { message: "token secreto" } } }];

    const error = await meta
      .exchangeEmbeddedSignupCode({
        code: "codigo-invalido",
        appId: "app-123",
        appSecret: "segredo-do-app",
        fetchImpl: fetchFake,
      })
      .catch((caught) => caught);
    expect(error).toMatchObject({ message: "A Graph API recusou a troca do código (400)." });
    expect(error.message).not.toContain("token secreto");
  });

  it("lista os telefones da WABA com token somente no header", async () => {
    rede.responses = [{ ok: true, status: 200, body: { data: [{ id: "phone-1" }] } }];

    await expect(
      meta.fetchWhatsappPhoneNumbers({
        wabaId: "waba-1",
        accessToken: "token-do-cliente",
        fetchImpl: fetchFake,
      }),
    ).resolves.toEqual([{ id: "phone-1" }]);
    expect(rede.calls[0].url).toContain("/v25.0/waba-1/phone_numbers");
    expect(rede.calls[0].init.headers.authorization).toBe("Bearer token-do-cliente");
    expect(rede.calls[0].url).not.toContain("token-do-cliente");
  });

  it("inscreve o WABA no webhook do app", async () => {
    rede.responses = [{ ok: true, status: 200, body: { success: true } }];

    await expect(
      meta.subscribeWhatsappBusinessAccount({
        wabaId: "waba-1",
        accessToken: "token-do-cliente",
        graphVersion: "v26.0",
        fetchImpl: fetchFake,
      }),
    ).resolves.toEqual({ success: true });
    expect(rede.calls[0]).toMatchObject({
      url: "https://graph.facebook.com/v26.0/waba-1/subscribed_apps",
      init: { method: "POST" },
    });
  });
});
