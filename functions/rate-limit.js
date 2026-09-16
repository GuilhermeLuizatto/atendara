import { createHash } from "node:crypto";

import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

import { paths } from "./generated/paths.js";
import { CALLABLE_RATE_LIMITS } from "./generated/platform-config.js";

/**
 * Limite por SUJEITO, em janela fixa, contado numa transacao.
 *
 * Conta a TENTATIVA, nao o sucesso: quem insiste em chamadas que falham adiante
 * tambem esta gastando instancia e cota. O documento carrega `expiresAt` para a
 * politica de TTL apagar a janela vencida.
 *
 * O sujeito quase sempre e o `uid`. No cadastro aberto ainda nao existe conta,
 * e ai o sujeito e a origem da requisicao — `networkSubject`.
 */
export async function consumeRateLimit(subject, limitKey, nowMs = Date.now()) {
  const limit = CALLABLE_RATE_LIMITS[limitKey];
  if (!limit) throw new Error(`Limite nao configurado: ${limitKey}`);

  const db = getFirestore();
  const ref = db.doc(paths.platformRateLimit(`${limitKey}_${subject}`));
  const windowMs = limit.windowSeconds * 1000;

  await db.runTransaction(async (transaction) => {
    const current = (await transaction.get(ref)).data();
    const sameWindow = Boolean(current) && nowMs - current.windowStartMs < windowMs;
    const count = sameWindow ? current.count : 0;
    if (count >= limit.max) {
      throw new HttpsError("resource-exhausted", "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.");
    }
    const windowStartMs = sameWindow ? current.windowStartMs : nowMs;
    transaction.set(ref, {
      callable: limitKey,
      subject,
      windowStartMs,
      count: count + 1,
      expiresAt: new Date(windowStartMs + windowMs),
    });
  });
}

/**
 * Sujeito derivado da origem da requisicao, para as chamadas sem conta.
 *
 * Guardamos o RESUMO, nunca o endereco: o IP e dado pessoal, e o contador so
 * precisa saber que duas chamadas vieram da mesma origem. Sem cabecalho
 * confiavel, todas caem no mesmo balde — o limite aperta, que e o lado certo
 * de errar.
 *
 * `x-forwarded-for` vem da infraestrutura do Google na frente da function; o
 * primeiro salto e o cliente. Um cliente pode forjar o cabecalho e escolher o
 * proprio balde, e por isso este teto nunca e a unica trava: App Check,
 * confirmacao de e-mail e concessao unica por organizacao seguem valendo.
 */
export function networkSubject(request) {
  const forwarded = request.rawRequest?.headers?.["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  const origin = first || request.rawRequest?.ip || "desconhecida";
  return `rede-${createHash("sha256").update(origin).digest("hex").slice(0, 32)}`;
}
