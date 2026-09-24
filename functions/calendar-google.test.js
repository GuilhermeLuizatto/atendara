import { describe, expect, it } from "vitest";

import {
  accessTokenFor,
  GoogleCalendarError,
  reconcileEvent,
  ReconnectRequiredError,
  syncResultFrom,
} from "./calendar-google.js";

const EVENT = {
  summary: "Atendimento",
  startsAt: "2099-01-10T12:00:00.000Z",
  endsAt: "2099-01-10T13:00:00.000Z",
  description: null,
};
const BASE = "https://www.googleapis.com/calendar/v3/calendars/agenda%40group/events";

function google(...responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init.body && init.body.startsWith("{") ? JSON.parse(init.body) : (init.body ?? null);
    calls.push({ url: String(url), method: init.method, body });
    const next = responses.shift() ?? { status: 200 };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body ?? {},
    };
  };
  return { calls, fetchImpl };
}

const reconcile = (event, fetchImpl) =>
  reconcileEvent({ accessToken: "curto", calendarId: "agenda@group", eventId: "abc123", event }, fetchImpl);

describe("deixar o evento do Google igual ao atendimento", () => {
  it("evento existente é atualizado com só o que a profissão permite", async () => {
    const { calls, fetchImpl } = google({ status: 200 });
    expect(await reconcile(EVENT, fetchImpl)).toBe("UPDATED");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: `${BASE}/abc123`, method: "PUT" });
    expect(calls[0].body).toEqual({
      id: "abc123",
      summary: "Atendimento",
      start: { dateTime: EVENT.startsAt },
      end: { dateTime: EVENT.endsAt },
      status: "confirmed",
      visibility: "private",
    });
  });

  it("evento que não existe é criado com o id do atendimento", async () => {
    const { calls, fetchImpl } = google({ status: 404 }, { status: 200 });
    expect(await reconcile(EVENT, fetchImpl)).toBe("CREATED");
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["PUT", `${BASE}/abc123`],
      ["POST", BASE],
    ]);
    expect(calls[1].body.id).toBe("abc123");
  });

  it("id já usado por evento apagado volta pela atualização", async () => {
    const { calls, fetchImpl } = google({ status: 404 }, { status: 409 }, { status: 200 });
    expect(await reconcile(EVENT, fetchImpl)).toBe("RESTORED");
    expect(calls.map((call) => call.method)).toEqual(["PUT", "POST", "PUT"]);
  });

  it("apagar evento que já não existe conta como feito", async () => {
    for (const status of [200, 204, 404, 410]) {
      const { calls, fetchImpl } = google({ status });
      expect(await reconcile(null, fetchImpl)).toBe("DELETED");
      expect(calls[0]).toMatchObject({ url: `${BASE}/abc123`, method: "DELETE" });
    }
  });

  it("401 e 403 de permissão pedem reconexão; 403 de limite é temporário", async () => {
    await expect(reconcile(EVENT, google({ status: 401 }).fetchImpl)).rejects.toBeInstanceOf(ReconnectRequiredError);
    await expect(
      reconcile(EVENT, google({ status: 403, body: { error: { errors: [{ reason: "forbidden" }] } } }).fetchImpl),
    ).rejects.toBeInstanceOf(ReconnectRequiredError);
    await expect(
      reconcile(EVENT, google({ status: 403, body: { error: { errors: [{ reason: "rateLimitExceeded" }] } } }).fetchImpl),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("agenda Atendara apagada no Google aparece como 404 na criação", async () => {
    await expect(reconcile(EVENT, google({ status: 404 }, { status: 404 }).fetchImpl)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("resultado para a fila", () => {
  it("classifica sem carregar mensagem nem corpo", () => {
    expect(syncResultFrom(new ReconnectRequiredError())).toEqual({
      outcome: "PERMANENT_FAILURE",
      failureCode: "CALENDAR_RECONNECT_REQUIRED",
    });
    expect(syncResultFrom(new GoogleCalendarError(404))).toEqual({
      outcome: "PERMANENT_FAILURE",
      failureCode: "CALENDAR_NOT_PROVISIONED",
    });
    expect(syncResultFrom(new GoogleCalendarError(429))).toEqual({
      outcome: "TEMPORARY_FAILURE",
      failureCode: "RATE_LIMITED",
    });
    expect(syncResultFrom(new GoogleCalendarError(503))).toEqual({
      outcome: "TEMPORARY_FAILURE",
      failureCode: "PROVIDER_UNAVAILABLE",
    });
    expect(syncResultFrom(new Error("rede"))).toEqual({
      outcome: "TEMPORARY_FAILURE",
      failureCode: "PROVIDER_UNAVAILABLE",
    });
  });
});

describe("token de acesso", () => {
  const client = { clientId: "id", clientSecret: "segredo" };
  const decrypt = async () => "refresh-privado";

  it("troca a credencial cifrada por token curto", async () => {
    const { calls, fetchImpl } = google({ status: 200, body: { access_token: "curto" } });
    expect(await accessTokenFor("cifrado", { fetchImpl, decrypt, client })).toBe("curto");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
  });

  it("autorização revogada pede reconexão", async () => {
    const { fetchImpl } = google({ status: 400, body: { error: "invalid_grant" } });
    await expect(accessTokenFor("cifrado", { fetchImpl, decrypt, client })).rejects.toBeInstanceOf(
      ReconnectRequiredError,
    );
  });
});
