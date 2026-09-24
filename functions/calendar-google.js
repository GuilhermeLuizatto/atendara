import { decryptSecret } from "./kms.js";
import { GOOGLE_CALENDAR_NAME } from "./generated/calendar-config.js";

/**
 * Chamadas ao Google Calendar feitas pelo backend (3C).
 *
 * Um lugar so para trocar a credencial cifrada por token de acesso e falar com a
 * API: a consulta manual de ocupado, o retorno OAuth, a desconexao e o
 * despachante da fila usam as mesmas funcoes. Nenhuma devolve corpo de resposta
 * do Google em erro — ele pode repetir token ou conteudo de evento.
 */

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

export const requestGoogle = (url, init, fetchImpl = fetch) =>
  fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });

/** Falha que so se resolve com nova autorizacao de quem e dono da agenda. */
export class ReconnectRequiredError extends Error {
  constructor() {
    super("A autorização do Google expirou ou foi revogada.");
    this.name = "ReconnectRequiredError";
  }
}

/** Falha do Google com o status HTTP, sem o corpo. */
export class GoogleCalendarError extends Error {
  constructor(status) {
    super(`O Google respondeu ${status}.`);
    this.name = "GoogleCalendarError";
    this.status = status;
  }
}

export function googleClient(env = process.env) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret || !env.CALENDAR_KMS_KEY) return null;
  return { clientId, clientSecret };
}

/** Credencial cifrada -> token de acesso curto. So existe na memoria de quem chama. */
export async function accessTokenFor(ciphertext, deps = {}) {
  const { fetchImpl = fetch, decrypt = decryptSecret, client = googleClient() } = deps;
  if (!client) throw new Error("Integração de agenda não configurada.");
  const refreshToken = await decrypt(ciphertext);
  const response = await requestGoogle(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "refresh_token",
      }).toString(),
    },
    fetchImpl,
  );
  const token = await response.json().catch(() => ({}));
  if (token.error === "invalid_grant") throw new ReconnectRequiredError();
  if (!response.ok || typeof token.access_token !== "string" || !token.access_token) {
    throw new GoogleCalendarError(response.status);
  }
  return token.access_token;
}

function call(accessToken, path, init, fetchImpl) {
  return requestGoogle(
    `${API}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    },
    fetchImpl,
  );
}

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]);

/**
 * O Google usa 403 tanto para permissao negada quanto para limite de uso. So o
 * motivo separa os dois; o corpo e lido para isso e descartado.
 */
async function fail(response) {
  if (response.status === 401) throw new ReconnectRequiredError();
  if (response.status === 403) {
    const data = await response.json().catch(() => ({}));
    const reasons = Array.isArray(data?.error?.errors) ? data.error.errors.map((item) => item?.reason) : [];
    if (reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))) throw new GoogleCalendarError(429);
    throw new ReconnectRequiredError();
  }
  throw new GoogleCalendarError(response.status);
}

/**
 * Cria a agenda "Atendara" na conta de quem atende. Com `app.created`, e a
 * unica agenda em que o Atendara pode escrever.
 */
export async function createAtendaraCalendar({ accessToken, timeZone }, fetchImpl = fetch) {
  const response = await call(
    accessToken,
    "/calendars",
    { method: "POST", body: JSON.stringify({ summary: GOOGLE_CALENDAR_NAME, timeZone }) },
    fetchImpl,
  );
  if (!response.ok) await fail(response);
  const data = await response.json();
  if (typeof data?.id !== "string" || !data.id) throw new GoogleCalendarError(response.status);
  return data.id;
}

/** A agenda criada numa conexao anterior ainda existe? Reaproveitar evita duas. */
export async function calendarExists({ accessToken, calendarId }, fetchImpl = fetch) {
  const response = await call(accessToken, `/calendars/${encodeURIComponent(calendarId)}`, { method: "GET" }, fetchImpl);
  if (response.ok) return true;
  if (response.status === 404 || response.status === 410) return false;
  return await fail(response);
}

/** Apaga a agenda "Atendara" inteira. Ja apagada conta como feito. */
export async function deleteAtendaraCalendar({ accessToken, calendarId }, fetchImpl = fetch) {
  const response = await call(accessToken, `/calendars/${encodeURIComponent(calendarId)}`, { method: "DELETE" }, fetchImpl);
  if (response.ok || response.status === 404 || response.status === 410) return;
  await fail(response);
}

function eventBody(eventId, event) {
  return {
    id: eventId,
    summary: event.summary,
    ...(event.description ? { description: event.description } : {}),
    start: { dateTime: event.startsAt },
    end: { dateTime: event.endsAt },
    status: "confirmed",
    // Agenda compartilhada pelo profissional nao mostra o titulo a terceiros.
    visibility: "private",
  };
}

/**
 * Deixa o Google igual ao Atendara para UM evento.
 *
 * `event` nulo apaga. Com evento: atualiza; se nao existe, cria com o id
 * derivado do atendimento; se o id ja foi usado por um evento apagado, o Google
 * responde 409 e a atualizacao o traz de volta.
 */
export async function reconcileEvent({ accessToken, calendarId, eventId, event }, fetchImpl = fetch) {
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
  const path = `${base}/${eventId}`;

  if (!event) {
    const removed = await call(accessToken, path, { method: "DELETE" }, fetchImpl);
    if (removed.ok || removed.status === 404 || removed.status === 410) return "DELETED";
    return await fail(removed);
  }

  const body = JSON.stringify(eventBody(eventId, event));
  const updated = await call(accessToken, path, { method: "PUT", body }, fetchImpl);
  if (updated.ok) return "UPDATED";
  if (updated.status !== 404) return await fail(updated);

  const created = await call(accessToken, base, { method: "POST", body }, fetchImpl);
  if (created.ok) return "CREATED";
  if (created.status !== 409) return await fail(created);

  const restored = await call(accessToken, path, { method: "PUT", body }, fetchImpl);
  if (restored.ok) return "RESTORED";
  return await fail(restored);
}

/** Erro do Google -> resultado da fila, sem mensagem nem corpo. */
export function syncResultFrom(error) {
  if (error instanceof ReconnectRequiredError) {
    return { outcome: "PERMANENT_FAILURE", failureCode: "CALENDAR_RECONNECT_REQUIRED" };
  }
  if (error instanceof GoogleCalendarError && error.status === 404) {
    // A agenda "Atendara" foi apagada pela propria pessoa no Google.
    return { outcome: "PERMANENT_FAILURE", failureCode: "CALENDAR_NOT_PROVISIONED" };
  }
  if (error instanceof GoogleCalendarError && error.status === 429) {
    return { outcome: "TEMPORARY_FAILURE", failureCode: "RATE_LIMITED" };
  }
  return { outcome: "TEMPORARY_FAILURE", failureCode: "PROVIDER_UNAVAILABLE" };
}
