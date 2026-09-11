import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

import { paths } from "./generated/paths.js";
import { CALLABLE_RATE_LIMITS } from "./generated/platform-config.js";

/**
 * Limite por usuario, em janela fixa, contado numa transacao.
 *
 * Conta a TENTATIVA, nao o sucesso: quem insiste em chamadas que falham adiante
 * tambem esta gastando instancia e cota. O documento carrega `expiresAt` para a
 * politica de TTL apagar a janela vencida.
 */
export async function consumeRateLimit(userId, callable, nowMs = Date.now()) {
  const limit = CALLABLE_RATE_LIMITS[callable];
  if (!limit) throw new Error(`Callable sem limite configurado: ${callable}`);

  const db = getFirestore();
  const ref = db.doc(paths.platformRateLimit(`${callable}_${userId}`));
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
      callable,
      userId,
      windowStartMs,
      count: count + 1,
      expiresAt: new Date(windowStartMs + windowMs),
    });
  });
}
