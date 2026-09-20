import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import { toStored, fromStored } from "./firestore-dates.js";
import { GOOGLE_CALENDAR_SCOPES } from "./generated/calendar-config.js";
import { parseBusyBlocks } from "./generated/agenda-calendar.js";
import {
  BRIDGE_SIGNATURE_HEADER,
  BRIDGE_TIMESTAMP_HEADER,
  isWithinSignatureWindow,
} from "./generated/automation-bridge.js";
import { paths } from "./generated/paths.js";
import { encryptSecret } from "./kms.js";
import { verifyBridgeSignature } from "./n8n-bridge.js";
import { ACCOUNT_CALL_OPTIONS, accountOf, parse } from "./platform-auth.js";
import { consumeRateLimit } from "./rate-limit.js";
import { runAs } from "./service-accounts.js";

/**
 * Conexao com o Google Calendar do profissional (Fase 3, 13.7).
 *
 * **Quem conecta e a propria pessoa.** A operadora nao conecta agenda de
 * ninguem, e a organizacao nao conecta a agenda de um membro: o consentimento
 * do Google e dado por quem e dono do calendario, e o Atendara so guarda o que
 * aquela pessoa autorizou.
 *
 * **O token de atualizacao nunca chega ao navegador.** Ele e cifrado com Cloud
 * KMS antes de encostar no Firestore, e nenhuma callable o devolve. As Security
 * Rules recusam leitura da colecao inteira — nao existe caminho do cliente ate
 * ele, nem cifrado.
 *
 * **Desconectar apaga de verdade:** revoga no Google e apaga o texto cifrado.
 * Conexao revogada nao guarda material que um dia possa ser decifrado.
 */

const REGION = "southamerica-east1";
const SECRETS = ["GOOGLE_OAUTH_CLIENT_SECRET", "CALENDAR_STATE_SECRET"];
const CALL_OPTIONS = { ...ACCOUNT_CALL_OPTIONS, secrets: SECRETS, ...runAs("automacao") };

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** O estado do OAuth vale poucos minutos: e ida e volta de um clique. */
const STATE_WINDOW_SECONDS = 600;

const db = () => getFirestore();

const connectSchema = z.object({ professionalId: z.string().min(1).max(128) }).strict();

function stored(collection, snapshot) {
  return snapshot?.exists ? fromStored(collection, snapshot.id, snapshot.data()) : null;
}

/**
 * O `state` do OAuth carrega organizacao, profissional e instante, assinado.
 * Sem assinatura, alguem devolveria um `code` proprio dizendo ser de outra
 * pessoa — e a agenda do Google de um estranho viraria a agenda dela aqui.
 */
export function signState(secret, payload) {
  const corpo = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const assinatura = createHmac("sha256", secret).update(corpo).digest("base64url");
  return `${corpo}.${assinatura}`;
}

export function readState(secret, state, nowMs = Date.now()) {
  if (typeof state !== "string" || !state.includes(".")) return null;
  const [corpo, assinatura] = state.split(".");
  const esperada = createHmac("sha256", secret).update(corpo).digest("base64url");
  if (esperada.length !== (assinatura ?? "").length) return null;
  if (!timingSafeEqual(Buffer.from(esperada), Buffer.from(assinatura))) return null;

  try {
    const payload = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    if (typeof payload?.at !== "number" || nowMs - payload.at > STATE_WINDOW_SECONDS * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function redirectUri(env = process.env) {
  const base = env.CALENDAR_REDIRECT_URL;
  if (!base || !base.startsWith("https://")) throw new HttpsError("failed-precondition", "Integração de agenda não configurada.");
  return base;
}

/**
 * Passo 1: a pessoa pede para conectar e recebe o endereco do Google.
 *
 * Nada e gravado ainda — conexao so existe depois que o Google confirma.
 */
export const startCalendarConnection = onCall(CALL_OPTIONS, async (request) => {
  const account = await accountOf(request);
  await consumeRateLimit(request.auth.uid, "calendarConnection");
  const input = parse(connectSchema, request.data);

  // Só a própria pessoa conecta a própria agenda.
  if (account.id !== input.professionalId && request.auth.uid !== input.professionalId) {
    throw new HttpsError("permission-denied", "Cada pessoa conecta a própria agenda.");
  }
  const organizationId = account.organizationId;
  if (!organizationId) throw new HttpsError("failed-precondition", "Cadastro sem organização.");

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const stateSecret = process.env.CALENDAR_STATE_SECRET;
  if (!clientId || !stateSecret) throw new HttpsError("failed-precondition", "Integração de agenda não configurada.");

  const state = signState(stateSecret, {
    organizationId,
    professionalId: request.auth.uid,
    nonce: randomUUID(),
    at: Date.now(),
  });

  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  // `offline` + `consent` é o que devolve token de atualização; sem ele, a
  // conexão morre em uma hora e a agenda para de sincronizar sozinha.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);

  return { url: url.toString() };
});

/**
 * Passo 2: o Google devolve o `code` aqui. Troca por token, cifra o de
 * atualizacao e grava a conexao.
 */
export const googleOAuthCallback = onRequest(
  { region: REGION, maxInstances: 5, secrets: [...SECRETS], ...runAs("automacao") },
  async (request, response) => {
    const stateSecret = process.env.CALENDAR_STATE_SECRET;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!stateSecret || !clientSecret || !clientId) {
      response.status(503).send("Integração de agenda não configurada.");
      return;
    }

    const payload = readState(stateSecret, request.query?.state);
    if (!payload) {
      logger.warn("calendar.oauth.refused", { outcome: "BAD_STATE" });
      response.status(400).send("Pedido de conexão inválido ou vencido.");
      return;
    }
    const code = request.query?.code;
    if (typeof code !== "string" || !code) {
      response.status(400).send("Conexão cancelada.");
      return;
    }

    try {
      const troca = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri(),
          grant_type: "authorization_code",
        }).toString(),
      });
      const tokens = await troca.json();
      if (!troca.ok || typeof tokens?.refresh_token !== "string") {
        // Sem token de atualização não há conexão: guardar só o de acesso daria
        // uma hora de agenda e um silêncio depois.
        logger.warn("calendar.oauth.refused", { outcome: "NO_REFRESH_TOKEN" });
        response.status(400).send("O Google não devolveu autorização de longo prazo. Tente conectar de novo.");
        return;
      }

      const ciphertext = await encryptSecret(tokens.refresh_token);
      const now = new Date().toISOString();
      await db()
        .doc(paths.document(payload.organizationId, "calendarConnections", payload.professionalId))
        .set(
          toStored("calendarConnections", {
            id: payload.professionalId,
            organizationId: payload.organizationId,
            professionalId: payload.professionalId,
            provider: "GOOGLE",
            status: "CONNECTED",
            // O texto cifrado mora aqui; o claro nunca é gravado.
            refreshTokenCiphertext: ciphertext,
            scopes: [...GOOGLE_CALENDAR_SCOPES],
            calendarId: null,
            lastSyncAt: null,
            lastError: null,
            connectedAt: now,
            createdAt: now,
            createdBy: payload.professionalId,
            updatedAt: now,
            updatedBy: payload.professionalId,
          }),
        );

      logger.info("calendar.oauth.connected", {
        organizationId: payload.organizationId,
        professionalId: payload.professionalId,
      });
      response.status(200).send("Agenda conectada. Pode fechar esta aba e voltar ao Atendara.");
    } catch (error) {
      logger.error("calendar.oauth.failed", { message: String(error) });
      response.status(500).send("Não foi possível concluir a conexão.");
    }
  },
);

/**
 * Desconectar: revoga no Google e apaga o texto cifrado.
 *
 * Marcar como revogada e guardar o material seria deixar uma chave na gaveta
 * depois de dizer que ela foi devolvida.
 */
export const disconnectCalendar = onCall(CALL_OPTIONS, async (request) => {
  const account = await accountOf(request);
  await consumeRateLimit(request.auth.uid, "calendarConnection");
  const input = parse(connectSchema, request.data);
  if (request.auth.uid !== input.professionalId) {
    throw new HttpsError("permission-denied", "Cada pessoa desconecta a própria agenda.");
  }

  const ref = db().doc(paths.document(account.organizationId, "calendarConnections", input.professionalId));
  const connection = stored("calendarConnections", await ref.get());
  if (!connection) return { status: "REVOKED" };

  try {
    const { decryptSecret } = await import("./kms.js");
    const refreshToken = await decryptSecret(connection.refreshTokenCiphertext);
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
  } catch (error) {
    // O Google pode já ter revogado do lado dele. Falhar aqui não pode impedir
    // o apagamento: o que não pode sobrar é o material cifrado.
    logger.warn("calendar.revoke.failed", { message: String(error) });
  }

  const now = new Date().toISOString();
  await ref.set(
    toStored("calendarConnections", {
      ...connection,
      status: "REVOKED",
      refreshTokenCiphertext: null,
      calendarId: null,
      lastError: null,
      updatedAt: now,
      updatedBy: request.auth.uid,
    }),
  );
  return { status: "REVOKED" };
});

/**
 * O ocupado que o n8n leu no Google, entregue pela rota assinada.
 *
 * Entra **so faixa de tempo**: `parseBusyBlocks` descarta titulo, convidado e
 * descricao antes de qualquer gravacao.
 */
export const calendarBusyCallback = onRequest(
  { region: REGION, maxInstances: 5, secrets: ["N8N_CALLBACK_SECRET"], ...runAs("automacao") },
  async (request, response) => {
    const secret = process.env.N8N_CALLBACK_SECRET;
    if (!secret) {
      response.status(503).send("Integração de agenda não configurada.");
      return;
    }
    if (request.method !== "POST") {
      response.status(405).send("Método não suportado.");
      return;
    }

    const body = request.rawBody?.toString("utf8") ?? "";
    const timestamp = request.get(BRIDGE_TIMESTAMP_HEADER);
    if (!timestamp || !isWithinSignatureWindow(timestamp, new Date().toISOString())) {
      response.status(401).send("Assinatura inválida.");
      return;
    }
    if (!verifyBridgeSignature(secret, timestamp, body, request.get(BRIDGE_SIGNATURE_HEADER))) {
      response.status(401).send("Assinatura inválida.");
      return;
    }

    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = null;
    }
    const organizationId = typeof payload?.organizationId === "string" ? payload.organizationId : null;
    const professionalId = typeof payload?.professionalId === "string" ? payload.professionalId : null;
    if (!organizationId || !professionalId) {
      response.status(400).send("Retorno recusado.");
      return;
    }

    const now = new Date().toISOString();
    const blocks = parseBusyBlocks(payload.freeBusy);
    await db()
      .doc(paths.document(organizationId, "calendarBusyBlocks", professionalId))
      .set(
        toStored("calendarBusyBlocks", {
          id: professionalId,
          organizationId,
          professionalId,
          blocks,
          readAt: now,
          createdAt: now,
          createdBy: null,
          updatedAt: now,
          updatedBy: null,
        }),
      );

    logger.info("calendar.busy", { organizationId, professionalId, blocks: blocks.length });
    response.status(200).json({ blocks: blocks.length });
  },
);
