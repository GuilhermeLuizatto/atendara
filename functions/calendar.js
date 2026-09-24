import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { toStored } from "./firestore-dates.js";
import {
  GOOGLE_CALENDAR_SCOPES,
  CALENDAR_BUSY_WINDOW_DAYS,
} from "./generated/calendar-config.js";
import { parsePrimaryBusy } from "./generated/agenda-calendar.js";
import { encryptSecret, decryptSecret } from "./kms.js";
import { ACCOUNT_CALL_OPTIONS, accountOf, parse } from "./platform-auth.js";
import { consumeRateLimit } from "./rate-limit.js";
import { runAs } from "./service-accounts.js";
import {
  calendarData,
  calendarRef,
  calendarTransaction,
  writeConnection,
} from "./calendar-store.js";

const SECRETS = ["GOOGLE_OAUTH_CLIENT_SECRET", "CALENDAR_STATE_SECRET"];
const CALL_OPTIONS = {
  ...ACCOUNT_CALL_OPTIONS,
  secrets: SECRETS,
  ...runAs("automacao"),
};
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_WINDOW_MS = 600_000;
const id = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes("/") && value !== "." && value !== "..");
const connectSchema = z.object({ professionalId: id }).strict();
const stateSchema = z
  .object({
    organizationId: id,
    professionalId: id,
    userId: id,
    nonce: z.string().uuid(),
    at: z.number().int(),
  })
  .strict();
const requestGoogle = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });

export function signState(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function readState(secret, state, now = Date.now()) {
  if (
    typeof state !== "string" ||
    state.length > 2048 ||
    state.split(".").length !== 2
  )
    return null;
  const [body, signature] = state.split(".");
  const expected = createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  const received = Buffer.from(signature);
  if (
    Buffer.byteLength(expected) !== received.length ||
    !timingSafeEqual(Buffer.from(expected), received)
  )
    return null;
  try {
    const parsed = stateSchema.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    return parsed.success &&
      now >= parsed.data.at &&
      now - parsed.data.at < STATE_WINDOW_MS
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

function configuration() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const stateSecret = process.env.CALENDAR_STATE_SECRET;
  const redirectUri = process.env.CALENDAR_REDIRECT_URL;
  if (
    !clientId ||
    !clientSecret ||
    !stateSecret ||
    !process.env.CALENDAR_KMS_KEY ||
    !redirectUri?.startsWith("https://")
  ) {
    throw new HttpsError(
      "failed-precondition",
      "A conexão Google Calendar ainda precisa ser configurada pela equipe do Atendara.",
    );
  }
  return { clientId, clientSecret, stateSecret, redirectUri };
}

async function contextOf(request) {
  const account = await accountOf(request);

  if (!account.organizationId)
    throw new HttpsError("permission-denied", "Cadastro sem organização.");
  return { organizationId: account.organizationId, userId: request.auth.uid };
}

export const startCalendarConnection = onCall(CALL_OPTIONS, async (request) => {
  const context = {
    ...(await contextOf(request)),
    ...parse(connectSchema, request.data),
  };
  await consumeRateLimit(context.userId, "calendarConnection");
  const config = configuration();
  const payload = { ...context, nonce: randomUUID(), at: Date.now() };
  await calendarTransaction(context, (tx, ref, connection) => {
    writeConnection(tx, ref, context, connection, {
      pendingOAuth: { nonce: payload.nonce, at: payload.at, claimed: false },
    });
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  const params = {
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: signState(config.stateSecret, payload),
  };
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return { url: url.toString() };
});

function matchesPending(connection, payload) {
  return (
    connection?.pendingOAuth?.nonce === payload.nonce &&
    connection.pendingOAuth.at === payload.at &&
    Date.now() - payload.at < STATE_WINDOW_MS
  );
}

export const googleOAuthCallback = onRequest(
  {
    region: "southamerica-east1",
    maxInstances: 5,
    secrets: SECRETS,
    ...runAs("automacao"),
  },
  async (request, response) => {
    if (request.method !== "GET")
      return response.status(405).send("Método não suportado.");
    let config;
    try {
      config = configuration();
    } catch {
      return response.status(503).send("Integração de agenda não configurada.");
    }
    const context = readState(config.stateSecret, request.query?.state);
    if (!context)
      return response
        .status(400)
        .send("Pedido de conexão inválido ou vencido.");
    // Sem a etapa, uma falha em produção não se distingue entre Google, KMS e banco.
    let stage = "claim";
    try {
      // Uma autorização só pode ser consumida uma vez, mesmo com retornos simultâneos.
      await calendarTransaction(context, (tx, ref, connection) => {
        if (
          !matchesPending(connection, context) ||
          connection.pendingOAuth.claimed
        ) {
          throw new HttpsError(
            "failed-precondition",
            "Pedido já utilizado ou cancelado.",
          );
        }
        writeConnection(tx, ref, context, connection, {
          pendingOAuth: { ...connection.pendingOAuth, claimed: true },
        });
      });
      if (typeof request.query.code !== "string" || !request.query.code) {
        return response
          .status(400)
          .send("Conexão cancelada. Volte ao Atendara para tentar novamente.");
      }
      stage = "exchange";
      const exchange = await requestGoogle(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: request.query.code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });
      const tokens = await exchange.json();
      const scopes =
        typeof tokens.scope === "string" ? tokens.scope.split(" ") : [];
      if (
        !exchange.ok ||
        typeof tokens.refresh_token !== "string" ||
        !tokens.refresh_token ||
        !GOOGLE_CALENDAR_SCOPES.every((scope) => scopes.includes(scope))
      ) {
        logger.warn("calendar.oauth.rejected", {
          status: exchange.status,
          // Só o código curto do OAuth: a descrição livre pode repetir o pedido.
          error:
            typeof tokens.error === "string" &&
            /^[a-z_]{1,40}$/.test(tokens.error)
              ? tokens.error
              : null,
          refreshToken: typeof tokens.refresh_token === "string",
          scopeGranted: GOOGLE_CALENDAR_SCOPES.every((scope) =>
            scopes.includes(scope),
          ),
        });
        return response
          .status(400)
          .send(
            "Autorize a consulta de horários no Google e tente conectar novamente.",
          );
      }
      stage = "encrypt";
      const ciphertext = await encryptSecret(tokens.refresh_token);
      stage = "save";
      await calendarTransaction(context, (tx, ref, connection) => {
        if (
          !matchesPending(connection, context) ||
          !connection.pendingOAuth.claimed
        ) {
          throw new HttpsError(
            "failed-precondition",
            "Conexão cancelada durante a autorização.",
          );
        }
        writeConnection(tx, ref, context, connection, {
          status: "CONNECTED",
          generation: randomUUID(),
          refreshTokenCiphertext: ciphertext,
          scopes: [...GOOGLE_CALENDAR_SCOPES],
          calendarId: null,
          pendingOAuth: null,
          pendingRead: null,
          lastSyncAt: null,
          lastError: null,
          connectedAt: new Date().toISOString(),
        });
        tx.delete(calendarRef(context, "calendarBusyBlocks"));
      });
      return response
        .status(200)
        .send(
          "Agenda conectada. Feche esta aba, volte ao Atendara e clique em Verificar conexão.",
        );
    } catch (error) {
      // Códigos e tokens podem aparecer em erros HTTP: o registro não recebe o erro bruto.
      logger.warn("calendar.oauth.failed", {
        outcome: error instanceof HttpsError ? error.code : "PROVIDER_ERROR",
        stage,
        errorName: typeof error?.name === "string" ? error.name : null,
        status: Number.isInteger(error?.status) ? error.status : null,
      });
      return response
        .status(error instanceof HttpsError ? 400 : 500)
        .send(
          "Não foi possível concluir. Volte ao Atendara e tente conectar novamente.",
        );
    }
  },
);

export const getCalendarConnection = onCall(CALL_OPTIONS, async (request) => {
  const context = {
    ...(await contextOf(request)),
    ...parse(connectSchema, request.data),
  };
  await consumeRateLimit(context.userId, "calendarStatus");
  return calendarTransaction(context, async (tx, _ref, connection) => {
    const snapshot = calendarData(
      await tx.get(calendarRef(context, "calendarBusyBlocks")),
      "calendarBusyBlocks",
    );
    let configured = true;
    try {
      configuration();
    } catch {
      configured = false;
    }
    const legacy = connection?.status === "CONNECTED" && !connection.generation;
    // Lista explícita: nenhum campo novo da conexão privada vaza para o navegador.
    return {
      configured,
      status: legacy ? "ERROR" : connection?.status ?? "REVOKED",
      lastError: legacy ? "RECONNECT_REQUIRED" : connection?.lastError ?? null,
      connectedAt: connection?.connectedAt ?? null,
      snapshot:
        connection?.status === "CONNECTED" &&
        !legacy &&
        snapshot?.generation === connection.generation
          ? {
              readAt: snapshot.readAt,
              timeMin: snapshot.timeMin,
              timeMax: snapshot.timeMax,
              blocks: snapshot.blocks,
            }
          : null,
    };
  });
});

export const disconnectCalendar = onCall(CALL_OPTIONS, async (request) => {
  const context = {
    ...(await contextOf(request)),
    ...parse(connectSchema, request.data),
  };
  await consumeRateLimit(context.userId, "calendarDisconnect");
  const ciphertext = await calendarTransaction(
    context,
    (tx, ref, connection) => {
      // Apaga antes da rede: uma resposta atrasada nunca restaura uma conexão revogada.
      writeConnection(tx, ref, context, connection, {
        status: "REVOKED",
        generation: randomUUID(),
        refreshTokenCiphertext: null,
        pendingOAuth: null,
        pendingRead: null,
        calendarId: null,
        lastSyncAt: null,
        lastError: null,
        connectedAt: null,
        scopes: [],
      });
      tx.delete(calendarRef(context, "calendarBusyBlocks"));
      return connection?.refreshTokenCiphertext;
    },
    { disconnect: true },
  );
  let revokedAtGoogle = !ciphertext;
  if (ciphertext) {
    try {
      const token = await decryptSecret(ciphertext);
      const result = await requestGoogle(
        "https://oauth2.googleapis.com/revoke",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
        },
      );
      revokedAtGoogle = result.ok;
    } catch {
      logger.warn("calendar.revoke.failed", { outcome: "PROVIDER_ERROR" });
    }
  }
  return { status: "REVOKED", revokedAtGoogle };
});

export const refreshCalendarBusy = onCall(CALL_OPTIONS, async (request) => {
  const context = {
    ...(await contextOf(request)),
    ...parse(connectSchema, request.data),
  };
  await consumeRateLimit(context.userId, "calendarConnection");
  const config = configuration();
  const requestId = randomUUID();
  const timeMin = new Date().toISOString();
  const timeMax = new Date(
    Date.parse(timeMin) + CALENDAR_BUSY_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const original = await calendarTransaction(context, (tx, ref, connection) => {
    if (
      connection?.status !== "CONNECTED" ||
      !connection.refreshTokenCiphertext ||
      !connection.generation
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Conecte sua agenda Google novamente.",
      );
    }
    writeConnection(tx, ref, context, connection, { pendingRead: requestId });
    return connection;
  });
  let failure = "UNAVAILABLE";
  try {
    const refreshToken = await decryptSecret(original.refreshTokenCiphertext);
    const renewed = await requestGoogle(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
      }).toString(),
    });
    const token = await renewed.json();
    if (token.error === "invalid_grant") failure = "RECONNECT_REQUIRED";
    if (
      !renewed.ok ||
      typeof token.access_token !== "string" ||
      !token.access_token
    )
      throw new Error("TOKEN_UNAVAILABLE");
    const result = await requestGoogle(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] }),
      },
    );
    if (result.status === 401 || result.status === 403)
      failure = "RECONNECT_REQUIRED";
    if (!result.ok) throw new Error("BUSY_UNAVAILABLE");
    const blocks = parsePrimaryBusy(await result.json());
    if (blocks === null) throw new Error("BUSY_INCOMPLETE");
    await calendarTransaction(context, (tx, ref, connection) => {
      if (
        connection?.status !== "CONNECTED" ||
        connection.generation !== original.generation ||
        connection.pendingRead !== requestId
      ) {
        throw new HttpsError(
          "aborted",
          "A conexão mudou. Verifique a situação atual e tente novamente.",
        );
      }
      tx.set(
        calendarRef(context, "calendarBusyBlocks"),
        toStored("calendarBusyBlocks", {
          id: context.professionalId,
          organizationId: context.organizationId,
          professionalId: context.professionalId,
          generation: original.generation,
          blocks,
          timeMin,
          timeMax,
          readAt: timeMin,
          createdAt: timeMin,
          updatedAt: timeMin,
          createdBy: context.userId,
          updatedBy: context.userId,
        }),
      );
      writeConnection(tx, ref, context, connection, {
        lastSyncAt: timeMin,
        lastError: null,
        pendingRead: null,
      });
    });
    return { blocks: blocks.length };
  } catch (error) {
    // Uma falha não renova a validade da leitura anterior nem a substitui por agenda vazia.
    await calendarTransaction(context, (tx, ref, connection) => {
      if (
        connection?.generation === original.generation &&
        connection.pendingRead === requestId
      ) {
        writeConnection(tx, ref, context, connection, {
          lastError: failure,
          pendingRead: null,
          ...(failure === "RECONNECT_REQUIRED" ? { status: "ERROR" } : {}),
        });
      }
    });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "unavailable",
      failure === "RECONNECT_REQUIRED"
        ? "A autorização Google expirou ou foi revogada. Conecte sua agenda novamente."
        : "Não foi possível consultar o Google. A leitura anterior não foi atualizada.",
    );
  }
});

// O contrato antigo aceitava ocupado sem pedido correlacionado. Mantemos a rota
// fechada até existir uma tarefa de automação que permita validar sua origem.
export const calendarBusyCallback = onRequest(
  { region: "southamerica-east1", maxInstances: 2, ...runAs("automacao") },
  (_request, response) =>
    response
      .status(410)
      .send("Use a consulta autenticada de horários no Atendara."),
);
