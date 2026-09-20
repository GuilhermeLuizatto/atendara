import { createHmac, timingSafeEqual } from "node:crypto";

import { createN8nBridgeProvider } from "./generated/notifications-providers-n8n-bridge.js";
import { signedMessage } from "./generated/automation-bridge.js";

/**
 * A parte com segredo da ponte com o n8n (Fase 3, 13.3).
 *
 * O contrato e as decisoes estao em `src/lib/automation/bridge.ts`, puros e
 * testados sem emulador. Aqui fica o que precisa de `node:crypto` e do Secret
 * Manager: assinar o que sai e conferir o que volta.
 *
 * **Dois segredos, nao um.** O A assina a tarefa que vai; o B assina o
 * resultado que volta. Com um so, quem recebesse tarefas conseguiria forjar
 * resultados de qualquer outra organizacao — e e o n8n que fica na VPS, fora do
 * Google Cloud.
 */

export function signBridgeMessage(secret, timestamp, body) {
  return createHmac("sha256", secret).update(signedMessage(timestamp, body)).digest("hex");
}

/**
 * Comparacao em tempo constante. `timingSafeEqual` exige o mesmo tamanho, e
 * assinatura de tamanho errado ja e invalida.
 */
export function verifyBridgeSignature(secret, timestamp, body, signature) {
  if (typeof signature !== "string") return false;
  const expected = signBridgeMessage(secret, timestamp, body);
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
  } catch {
    return false;
  }
}

/**
 * O provedor pronto para o despachante, com o segredo A ja embutido. `null`
 * quando a ponte nao esta configurada — sem webhook ou sem segredo, nada sai, e
 * o canal que pedir a ponte falha com mensagem clara em vez de enviar por outro
 * caminho.
 */
export function bridgeProviderFrom(env = process.env) {
  const webhookUrl = env.N8N_WEBHOOK_URL;
  const secret = env.N8N_TASK_SECRET;
  if (!webhookUrl || !secret) return null;
  return createN8nBridgeProvider({
    webhookUrl,
    sign: (timestamp, body) => signBridgeMessage(secret, timestamp, body),
  });
}
