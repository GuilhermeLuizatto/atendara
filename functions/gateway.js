import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Conversa com o gateway de pagamento (Stripe), sem SDK.
 *
 * Sao duas responsabilidades e as duas cabem em pouca coisa: falar com a API
 * REST por formulario codificado e CONFERIR a assinatura do webhook. A segunda
 * e a que importa para a seguranca — e a unica prova de que um evento veio
 * mesmo do gateway e nao de quem descobriu a URL da function.
 *
 * ETAPA DE TESTES: `stripeRequest` recusa qualquer chave que nao seja
 * `sk_test_`. Enquanto esta trava existir, este codigo nao consegue emitir uma
 * cobranca real nem por engano nem por variavel de ambiente trocada. Remove-la
 * e uma decisao explicita, com o catalogo de planos ja confirmado.
 */

const STRIPE_API_BASE = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";

/**
 * Versao fixada. Sem isso, uma mudanca de formato do lado do gateway chega sem
 * aviso e o webhook passa a ler campos que mudaram de lugar.
 */
const STRIPE_API_VERSION = "2026-04-22.dahlia";

/** Tolerancia do carimbo do webhook. Cinco minutos e o padrao da Stripe. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

export class GatewayError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
  }
}

/**
 * Codificacao `application/x-www-form-urlencoded` com chaves aninhadas, que e
 * como a Stripe recebe objetos: `subscription_data[metadata][planId]`.
 */
export function encodeForm(params, prefix = "") {
  const pairs = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === "object") {
          pairs.push(encodeForm(item, `${name}[${index}]`));
        } else {
          pairs.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === "object") {
      pairs.push(encodeForm(value, name));
    } else {
      pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }

  return pairs.filter(Boolean).join("&");
}

export function isGatewayConfigured() {
  return typeof process.env.STRIPE_SECRET_KEY === "string" && process.env.STRIPE_SECRET_KEY.length > 0;
}

export async function stripeRequest(path, params = {}, options = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new GatewayError("Cobrança não configurada neste ambiente.", 503);
  if (!key.startsWith("sk_test_")) {
    throw new GatewayError("Esta etapa opera somente no ambiente de testes do gateway.", 503);
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  };
  // Chave de idempotencia: uma retentativa de rede nao cria duas assinaturas.
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const response = await fetch(`${STRIPE_API_BASE}/v1/${path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET" ? undefined : encodeForm(params),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GatewayError(payload?.error?.message ?? "Falha na comunicação com o gateway.", response.status);
  }
  return payload;
}

/**
 * Confere o cabecalho `Stripe-Signature` contra o corpo BRUTO.
 *
 * Tem que ser o corpo bruto: reserializar o JSON muda espacos e ordem de
 * chaves, e a assinatura deixa de bater. Por isso a function le `rawBody` e
 * nunca `request.body`.
 *
 * O cabecalho pode trazer mais de uma assinatura `v1` durante uma rotacao de
 * segredo — basta uma bater. A comparacao e em tempo constante, e o carimbo
 * fora da janela e recusado para que um evento capturado nao possa ser
 * reenviado dias depois.
 *
 * Devolve o evento ja parseado, ou `null` se a assinatura nao confere.
 */
export function verifyWebhookSignature(rawBody, header, secret, nowMs = Date.now()) {
  if (!rawBody || typeof header !== "string" || !secret) return null;

  let timestamp = null;
  const signatures = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name === "t") timestamp = value;
    else if (name === "v1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return null;
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return null;
  if (Math.abs(nowMs / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) return null;

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");

  const matched = signatures.some((signature) => {
    const candidate = Buffer.from(signature, "utf8");
    return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
  });
  if (!matched) return null;

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** Assina um corpo do mesmo jeito que o gateway. Usado pelos testes. */
export function signWebhookPayload(payload, secret, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${payload}`, "utf8")
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}
