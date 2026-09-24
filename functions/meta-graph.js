import { HttpsError } from "firebase-functions/v2/https";

const GRAPH_ORIGIN = "https://graph.facebook.com";
const DEFAULT_GRAPH_VERSION = "v25.0";

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpsError("failed-precondition", `${label} não configurado.`);
  }
  return value.trim();
}

function graphEndpoint(version, path, params = {}) {
  const url = new URL(`${GRAPH_ORIGIN}/${version}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function graphRequest(path, { version = DEFAULT_GRAPH_VERSION, token, method = "GET", params, body, fetchImpl = fetch } = {}) {
  const url = graphEndpoint(version, path, params);
  const headers = { authorization: `Bearer ${requiredText(token, "Token da Meta")}` };
  const init = { method, headers };

  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(body).toString();
  }

  const response = await fetchImpl(url, init);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.error) {
    // A resposta da Meta pode repetir tokens ou dados do cliente. Nunca a
    // devolvemos na mensagem da callable nem a registramos em log.
    throw new Error(`A Graph API recusou a operação (${response.status}).`);
  }
  return payload;
}

/**
 * Troca o código de uso único recebido pelo Embedded Signup por um token que
 * só deve continuar dentro do backend. O retorno é interno: a camada que
 * persiste a conexão precisa cifrar o token com KMS antes do Firestore.
 */
export async function exchangeEmbeddedSignupCode({ code, appId, appSecret, graphVersion, fetchImpl = fetch }) {
  const authorizationCode = requiredText(code, "Código do Embedded Signup");
  const clientId = requiredText(appId, "ID do app da Meta");
  const clientSecret = requiredText(appSecret, "App Secret da Meta");
  const version = graphVersion || DEFAULT_GRAPH_VERSION;
  const url = graphEndpoint(version, "oauth/access_token");

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: authorizationCode,
    }).toString(),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || typeof payload?.access_token !== "string") {
    throw new Error(`A Graph API recusou a troca do código (${response.status}).`);
  }

  return {
    accessToken: payload.access_token,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : null,
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : null,
  };
}

/** Lê a WABA retornada pelo fluxo usando o token recém-trocado. */
export function fetchWhatsappBusinessAccount({ wabaId, accessToken, graphVersion, fetchImpl = fetch }) {
  return graphRequest(wabaId, {
    version: graphVersion || DEFAULT_GRAPH_VERSION,
    token: accessToken,
    params: { fields: "id,name,currency,timezone_id" },
    fetchImpl,
  });
}

/** Confirma que o número enviado pelo evento pertence à WABA conectada. */
export async function fetchWhatsappPhoneNumbers({ wabaId, accessToken, graphVersion, fetchImpl = fetch }) {
  const payload = await graphRequest(`${wabaId}/phone_numbers`, {
    version: graphVersion || DEFAULT_GRAPH_VERSION,
    token: accessToken,
    params: { fields: "id,display_phone_number,verified_name,quality_rating,status" },
    fetchImpl,
  });
  return Array.isArray(payload?.data) ? payload.data : [];
}

/** Ativa a entrega de eventos do WABA para o app já configurado. */
export function subscribeWhatsappBusinessAccount({ wabaId, accessToken, graphVersion, fetchImpl = fetch }) {
  return graphRequest(`${wabaId}/subscribed_apps`, {
    version: graphVersion || DEFAULT_GRAPH_VERSION,
    token: accessToken,
    method: "POST",
    fetchImpl,
  });
}

