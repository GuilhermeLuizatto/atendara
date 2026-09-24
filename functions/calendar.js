import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import * as logger from "firebase-functions/logger";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { requeueTask } from "./automation.js";
import {
  accessTokenFor,
  calendarExists,
  createAtendaraCalendar,
  deleteAtendaraCalendar,
  googleClient,
  requestGoogle,
  ReconnectRequiredError,
  TOKEN_URL,
} from "./calendar-google.js";
import { fromStored, toStored } from "./firestore-dates.js";
import {
  canWriteCalendar,
  planCalendarBackfill,
  queueEnqueueAt,
} from "./generated/automation.js";
import { paths, TENANT_COLLECTIONS } from "./generated/paths.js";
import {
  GOOGLE_CALENDAR_SCOPES,
  CALENDAR_BUSY_WINDOW_DAYS,
  CALENDAR_REFRESH_MINUTES,
} from "./generated/calendar-config.js";
import { parsePrimaryBusy } from "./generated/agenda-calendar.js";
import { encryptSecret, decryptSecret } from "./kms.js";
import { ACCOUNT_CALL_OPTIONS, accountOf, parse } from "./platform-auth.js";
import { consumeRateLimit } from "./rate-limit.js";
import { runAs } from "./service-accounts.js";
import {
  calendarData,
  calendarOwnerAllowed,
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
/** Atendimentos enviados ao Google na conexão; o resto chega pelas próximas mudanças. */
const BACKFILL_LIMIT = 300;
const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

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

/**
 * A agenda "Atendara" desta conexão. Na volta de uma autorização caída, a
 * agenda anterior é reaproveitada se ainda existir — senão o Google ficaria com
 * duas. Falha aqui não impede conectar: a leitura de ocupado continua, e a tela
 * pede reconexão para escrever.
 */
async function provisionCalendar({ context, accessToken, previousCalendarId }) {
  if (typeof accessToken !== "string" || !accessToken) return null;
  try {
    if (previousCalendarId && (await calendarExists({ accessToken, calendarId: previousCalendarId }))) {
      return previousCalendarId;
    }
    const organization = (await getFirestore().doc(paths.organization(context.organizationId)).get()).data();
    return await createAtendaraCalendar({
      accessToken,
      timeZone: typeof organization?.timezone === "string" ? organization.timezone : DEFAULT_TIME_ZONE,
    });
  } catch (error) {
    logger.warn("calendar.provision.failed", {
      errorName: typeof error?.name === "string" ? error.name : null,
      status: Number.isInteger(error?.status) ? error.status : null,
    });
    return null;
  }
}

/**
 * Os atendimentos de hoje em diante vão para a agenda recém-conectada. Falhar
 * aqui não desfaz a conexão: cada mudança seguinte no atendimento acerta o
 * Google pela fila.
 */
async function backfillCalendar(context) {
  const firestore = getFirestore();
  const now = new Date().toISOString();
  try {
    const snapshot = await firestore
      .collection(paths.collection(context.organizationId, "appointments"))
      .where("professionalId", "==", context.professionalId)
      .where("startsAt", ">=", new Date(now))
      .orderBy("startsAt")
      .limit(BACKFILL_LIMIT)
      .get();
    const tasks = planCalendarBackfill({
      organizationId: context.organizationId,
      professionalId: context.professionalId,
      appointments: snapshot.docs.map((document) => fromStored("appointments", document.id, document.data())),
      waiting: [],
      at: now,
    });
    const batch = firestore.batch();
    for (const task of tasks) {
      batch.create(
        firestore.doc(paths.document(context.organizationId, "automationTasks", task.id)),
        toStored("automationTasks", task),
      );
    }
    await batch.commit();
    for (const task of tasks) await requeueTask(task, queueEnqueueAt(task, now));
    logger.info("calendar.backfill", { organizationId: context.organizationId, queued: tasks.length });
  } catch (error) {
    logger.warn("calendar.backfill.failed", {
      errorName: typeof error?.name === "string" ? error.name : null,
    });
  }
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
      const previousCalendarId = await calendarTransaction(context, (tx, ref, connection) => {
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
        // Só sobrevive a queda de autorização (ERROR); desconectar apaga a agenda.
        return connection.calendarId ?? null;
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
            "Autorize a consulta de horários e a agenda Atendara no Google e tente conectar novamente.",
          );
      }
      stage = "calendar";
      const calendarId = await provisionCalendar({
        context,
        accessToken: tokens.access_token,
        previousCalendarId,
      });
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
          calendarId,
          pendingOAuth: null,
          pendingRead: null,
          lastSyncAt: null,
          lastError: null,
          connectedAt: new Date().toISOString(),
        });
        tx.delete(calendarRef(context, "calendarBusyBlocks"));
      });
      stage = "backfill";
      if (calendarId) await backfillCalendar(context);
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
      // Conexões anteriores à escrita só leem ocupado até a próxima autorização.
      writeEnabled: !legacy && canWriteCalendar(connection ? { ...connection, scopes: connection.scopes ?? [] } : null),
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
  const previous = await calendarTransaction(
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
      return {
        ciphertext: connection?.refreshTokenCiphertext ?? null,
        calendarId: connection?.calendarId ?? null,
      };
    },
    { disconnect: true },
  );
  const { ciphertext } = previous;
  // Decisão do titular (24/09): sem sincronização, a agenda "Atendara" não
  // fica no Google com nome de cliente que ninguém mais atualiza.
  const calendarDeleted = previous.calendarId
    ? await removeAtendaraCalendar(ciphertext, previous.calendarId)
    : true;
  const revokedAtGoogle = ciphertext ? await revokeAtGoogle(ciphertext) : true;
  return { status: "REVOKED", revokedAtGoogle, calendarDeleted };
});

/** Revoga a credencial no Google. `false` quando o Google não confirmou. */
export async function revokeAtGoogle(ciphertext) {
  try {
    const token = await decryptSecret(ciphertext);
    const result = await requestGoogle("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return result.ok;
  } catch {
    logger.warn("calendar.revoke.failed", { outcome: "PROVIDER_ERROR" });
    return false;
  }
}

/**
 * Conexão apagada sem passar pela desconexão — exclusão da organização, pela
 * rotina de fim de teste ou a pedido. Quem apaga roda como outra conta, sem
 * acesso à chave nem ao segredo do Google; este gatilho, com os dois, apaga a
 * agenda "Atendara" e revoga a credencial com o que o documento tinha.
 */
export const cleanupDeletedCalendarConnection = onDocumentDeleted(
  {
    document: paths.document("{organizationId}", "calendarConnections", "{professionalId}"),
    region: "southamerica-east1",
    maxInstances: 2,
    secrets: ["GOOGLE_OAUTH_CLIENT_SECRET"],
    ...runAs("automacao"),
  },
  async (event) => {
    const data = event.data?.data();
    const ciphertext = typeof data?.refreshTokenCiphertext === "string" ? data.refreshTokenCiphertext : null;
    if (!ciphertext) return;
    const calendarDeleted = data.calendarId ? await removeAtendaraCalendar(ciphertext, data.calendarId) : true;
    const revokedAtGoogle = await revokeAtGoogle(ciphertext);
    logger.info("calendar.cleanup", {
      organizationId: event.params.organizationId,
      calendarDeleted,
      revokedAtGoogle,
    });
  },
);

/**
 * Apaga a agenda "Atendara" com a credencial que está saindo. Sem credencial
 * ou sem resposta do Google, a tela orienta apagar pela Conta Google.
 */
export async function removeAtendaraCalendar(ciphertext, calendarId, deps = {}) {
  if (!ciphertext || !calendarId) return false;
  try {
    const accessToken = await accessTokenFor(ciphertext, deps);
    await deleteAtendaraCalendar({ accessToken, calendarId }, deps.fetchImpl);
    return true;
  } catch (error) {
    logger.warn("calendar.delete_calendar.failed", {
      errorName: typeof error?.name === "string" ? error.name : null,
      status: Number.isInteger(error?.status) ? error.status : null,
    });
    return false;
  }
}

/**
 * Uma leitura de ocupado da agenda principal, do pedido à gravação. Usada pela
 * consulta manual e pela rotina de 30 em 30 minutos. Nunca lança erro do
 * Google: devolve o resultado, e quem chama decide o que dizer.
 *
 * Uma falha não renova a validade da leitura anterior nem a substitui por
 * agenda vazia. Autorização revogada põe a conexão em `ERROR`.
 */
export async function readBusyNow(context, { client, clock = () => new Date().toISOString() } = {}) {
  const requestId = randomUUID();
  const timeMin = clock();
  const timeMax = new Date(
    Date.parse(timeMin) + CALENDAR_BUSY_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const original = await calendarTransaction(context, (tx, ref, connection) => {
    if (
      connection?.status !== "CONNECTED" ||
      !connection.refreshTokenCiphertext ||
      !connection.generation
    ) {
      return null;
    }
    writeConnection(tx, ref, context, connection, { pendingRead: requestId });
    return connection;
  });
  if (!original) return { ok: false, failure: "NOT_CONNECTED" };

  let failure = "UNAVAILABLE";
  try {
    let accessToken;
    try {
      accessToken = await accessTokenFor(original.refreshTokenCiphertext, { client });
    } catch (error) {
      if (error instanceof ReconnectRequiredError) failure = "RECONNECT_REQUIRED";
      throw error;
    }
    const result = await requestGoogle(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
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
    const saved = await calendarTransaction(context, (tx, ref, connection) => {
      // Desconectar, reconectar ou uma leitura mais nova no meio: esta resposta
      // chegou tarde e não vale mais.
      if (
        connection?.status !== "CONNECTED" ||
        connection.generation !== original.generation ||
        connection.pendingRead !== requestId
      ) {
        return false;
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
      return true;
    });
    return saved ? { ok: true, blocks: blocks.length } : { ok: false, failure: "ABORTED" };
  } catch {
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
    return { ok: false, failure };
  }
}

export const refreshCalendarBusy = onCall(CALL_OPTIONS, async (request) => {
  const context = {
    ...(await contextOf(request)),
    ...parse(connectSchema, request.data),
  };
  await consumeRateLimit(context.userId, "calendarConnection");
  const config = configuration();
  const outcome = await readBusyNow(context, {
    client: { clientId: config.clientId, clientSecret: config.clientSecret },
  });
  if (outcome.ok) return { blocks: outcome.blocks };
  if (outcome.failure === "NOT_CONNECTED") {
    throw new HttpsError("failed-precondition", "Conecte sua agenda Google novamente.");
  }
  if (outcome.failure === "ABORTED") {
    throw new HttpsError(
      "aborted",
      "A conexão mudou. Verifique a situação atual e tente novamente.",
    );
  }
  throw new HttpsError(
    "unavailable",
    outcome.failure === "RECONNECT_REQUIRED"
      ? "A autorização Google expirou ou foi revogada. Conecte sua agenda novamente."
      : "Não foi possível consultar o Google. A leitura anterior não foi atualizada.",
  );
});

/** Conexões lidas por vez: o Google e o Firestore aguentam; a rotina termina em minutos. */
const REFRESH_CONCURRENCY = 5;
const REFRESH_PAGE_SIZE = 200;

/**
 * Lê o ocupado de toda agenda conectada (3C, frente 2). Quem perdeu o vínculo
 * ou está com a assinatura vencida é pulado — a mesma conferência da consulta
 * manual. Nenhum registro leva nome, horário ou conteúdo: só contagens.
 */
export async function refreshAllCalendars(deps = {}) {
  const { firestore = getFirestore(), client = googleClient(), clock } = deps;
  const tally = { read: 0, skipped: 0, reconnect: 0, failed: 0 };
  if (!client) return { ...tally, configured: false };

  const base = firestore
    .collectionGroup(TENANT_COLLECTIONS.calendarConnections)
    .where("status", "==", "CONNECTED")
    .orderBy(FieldPath.documentId())
    .limit(REFRESH_PAGE_SIZE);
  let cursor = null;
  for (;;) {
    const page = await (cursor ? base.startAfter(cursor) : base).get();
    const documents = page.docs;
    for (let index = 0; index < documents.length; index += REFRESH_CONCURRENCY) {
      await Promise.all(
        documents.slice(index, index + REFRESH_CONCURRENCY).map(async (document) => {
          const organizationId = document.ref.parent.parent?.id;
          const professionalId = document.id;
          if (!organizationId) {
            tally.skipped += 1;
            return;
          }
          const professional = (
            await firestore.doc(paths.document(organizationId, "professionals", professionalId)).get()
          ).data();
          const context = { organizationId, professionalId, userId: professional?.userId ?? null };
          const allowed =
            !!context.userId &&
            (await firestore.runTransaction((transaction) => calendarOwnerAllowed(transaction, context)));
          if (!allowed) {
            tally.skipped += 1;
            return;
          }
          try {
            const outcome = await readBusyNow(context, { client, clock });
            if (outcome.ok) tally.read += 1;
            else if (outcome.failure === "RECONNECT_REQUIRED") tally.reconnect += 1;
            else if (outcome.failure === "UNAVAILABLE") tally.failed += 1;
            else tally.skipped += 1;
          } catch {
            tally.failed += 1;
          }
        }),
      );
    }
    if (documents.length < REFRESH_PAGE_SIZE) break;
    cursor = documents[documents.length - 1];
  }
  return { ...tally, configured: true };
}

export const refreshCalendarBusyEvery30Minutes = onSchedule(
  {
    schedule: `every ${CALENDAR_REFRESH_MINUTES} minutes`,
    region: "southamerica-east1",
    timeoutSeconds: 540,
    maxInstances: 1,
    secrets: ["GOOGLE_OAUTH_CLIENT_SECRET"],
    ...runAs("automacao"),
  },
  async () => {
    const result = await refreshAllCalendars();
    logger.info("calendar.busy.refresh", result);
  },
);

// O contrato antigo aceitava ocupado sem pedido correlacionado. Mantemos a rota
// fechada até existir uma tarefa de automação que permita validar sua origem.
export const calendarBusyCallback = onRequest(
  { region: "southamerica-east1", maxInstances: 2, ...runAs("automacao") },
  (_request, response) =>
    response
      .status(410)
      .send("Use a consulta autenticada de horários no Atendara."),
);
