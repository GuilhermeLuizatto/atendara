// Gerado por scripts/build-functions.mjs.
import { ACCESS_GRANT_REASON_LENGTH, MAX_ACCESS_GRANT_DAYS, PLATFORM_ADMIN_SECOND_FACTORS, } from "./platform-config.js";
import { toAccountSubscriptionStatus } from "./billing-policy.js";
/**
 * O portao de acesso da conta quando existem DUAS origens de validade: a
 * assinatura confirmada pelo gateway e a concessao registrada pela operadora.
 *
 * Funcoes puras, compartilhadas com o backend por `build-functions.mjs`. Quem
 * aplica e o backend — o webhook e as callables de concessao, dentro da mesma
 * transacao que le as duas origens.
 */
const DAY_MS = 86_400_000;
export function isGrantInForce(grant, nowMs) {
    return Boolean(grant && !grant.revokedAt && Date.parse(grant.until) > nowMs);
}
/**
 * A maior validade entre as duas origens vigentes.
 *
 * - Evento `INCOMPLETE`, `PAST_DUE` ou reembolso nao fecha uma concessao
 *   vigente: a assinatura deixa de abrir, a concessao continua abrindo.
 * - Concessao nunca encurta ciclo pago: se a assinatura vai mais longe, vale ela.
 * - Sem concessao vigente, o portao e exatamente o que a assinatura diz — e a
 *   revogacao antecipada fecha so a parte concedida.
 */
export function resolveAccountGate(input) {
    const { subscription, grant, nowMs } = input;
    const paid = subscription
        ? {
            subscriptionStatus: toAccountSubscriptionStatus(subscription.status),
            accessUntil: subscription.accessUntil,
        }
        : null;
    if (!grant || !isGrantInForce(grant, nowMs)) {
        return paid ?? { subscriptionStatus: "PENDING", accessUntil: null };
    }
    const paidOpen = paid?.subscriptionStatus === "ACTIVE" &&
        paid.accessUntil !== null &&
        Date.parse(paid.accessUntil) > nowMs;
    if (paid && paidOpen && Date.parse(paid.accessUntil) >= Date.parse(grant.until)) {
        return paid;
    }
    return { subscriptionStatus: "ACTIVE", accessUntil: grant.until };
}
/** `null` quando a validade pedida cabe na politica; senao, o motivo. */
export function accessGrantWindowError(until, nowMs) {
    const untilMs = Date.parse(until);
    if (!Number.isFinite(untilMs) || untilMs <= nowMs)
        return "Defina uma validade futura.";
    if (untilMs > nowMs + MAX_ACCESS_GRANT_DAYS * DAY_MS) {
        return `A concessao vale no maximo ${MAX_ACCESS_GRANT_DAYS} dias. Para ir alem, conceda de novo com novo motivo.`;
    }
    return null;
}
export function accessGrantReasonError(reason) {
    const length = reason.trim().length;
    if (length < ACCESS_GRANT_REASON_LENGTH.min)
        return "Explique o motivo da concessao.";
    if (length > ACCESS_GRANT_REASON_LENGTH.max)
        return "Resuma o motivo da concessao.";
    return null;
}
/**
 * Segundo fator exigido da operadora, lido do token decodificado.
 *
 * O token chega verificado pelo SDK das functions; aqui so se confere qual
 * fator a sessao usou. Ausente, desconhecido ou de outro tipo: recusa.
 */
export function hasRequiredSecondFactor(token) {
    if (!token || typeof token !== "object")
        return false;
    const firebase = token.firebase;
    if (!firebase || typeof firebase !== "object")
        return false;
    const factor = firebase.sign_in_second_factor;
    return typeof factor === "string" && PLATFORM_ADMIN_SECOND_FACTORS.includes(factor);
}
