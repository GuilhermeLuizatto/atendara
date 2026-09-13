// Gerado por scripts/build-functions.mjs.
import { isRetriable, MAX_DELIVERY_DELAY_MINUTES, RETRY_POLICY, } from "./notifications-config.js";
import { addMinutes, minutesBetween } from "./notifications-schedule.js";
/**
 * Identidade de uma entrega.
 *
 * O id do documento e derivado do que a entrega E — atendimento, evento, canal
 * e horario planejado — e nao sorteado. E o mesmo truque de
 * `platformGatewayEvents/{eventId}`: replanejar o mesmo aviso duas vezes escreve
 * no mesmo documento em vez de criar um segundo, entao duplicidade deixa de
 * depender de alguem lembrar de conferir antes.
 *
 * O horario entra na chave arredondado ao minuto: dois planejamentos do mesmo
 * lembrete separados por milissegundos sao o mesmo lembrete. Mas remarcar o
 * atendimento para outro horario muda a chave — e ai sao dois avisos mesmo,
 * porque o antigo precisa ser cancelado e o novo enviado.
 */
export function deliveryKey(input) {
    const minute = input.scheduledFor.slice(0, 16).replace(/[:-]/g, "");
    return `${input.appointmentId}_${input.event}_${input.channel}_${minute}`;
}
/** Estados a partir dos quais ainda existe envio previsto. */
const PENDING = ["PLANNED", "SENDING"];
export function isPending(delivery) {
    return PENDING.includes(delivery.status);
}
/**
 * Esta entrega deve ser tentada agora?
 *
 * `nextAttemptAt` domina quando existe: e a espera entre tentativas. Sem ele,
 * vale o horario planejado.
 */
export function isDue(delivery, now) {
    if (delivery.status !== "PLANNED")
        return false;
    const at = delivery.nextAttemptAt ?? delivery.scheduledFor;
    return Date.parse(at) <= Date.parse(now);
}
/**
 * Passou tanto do horario que enviar seria pior que nao enviar. Lembrete que
 * chega depois do atendimento nao lembra nada.
 */
export function isExpired(delivery, now) {
    return (delivery.status === "PLANNED" &&
        minutesBetween(delivery.scheduledFor, now) > MAX_DELIVERY_DELAY_MINUTES);
}
/**
 * O que acontece com a entrega depois de uma tentativa.
 *
 * Tres saidas, e a do meio e a que justifica a funcao existir:
 *
 * - aceito -> `SENT`, sem nova tentativa;
 * - falha temporaria com tentativa sobrando -> continua `PLANNED`, com
 *   `nextAttemptAt` adiante segundo o backoff;
 * - recusa definitiva, ou tentativas esgotadas -> `FAILED`, sem nova tentativa.
 *
 * Recusa definitiva (destino invalido, remetente nao autorizado) nao ganha nova
 * tentativa: repetir nao muda o resultado e so multiplica registro e custo.
 */
export function applyAttempt(delivery, result, now) {
    const attempts = delivery.attempts + 1;
    const base = {
        attempts,
        lastAttemptAt: now,
        providerMessageId: result.providerMessageId,
    };
    if (result.outcome === "ACCEPTED") {
        return {
            ...base,
            status: "SENT",
            nextAttemptAt: null,
            failureCode: null,
            sentAt: now,
        };
    }
    const failureCode = result.failureCode ?? "PROVIDER_UNAVAILABLE";
    const canRetry = result.outcome === "TEMPORARY_FAILURE" &&
        isRetriable(failureCode) &&
        attempts < RETRY_POLICY.maxAttempts;
    if (!canRetry) {
        return {
            ...base,
            status: "FAILED",
            nextAttemptAt: null,
            failureCode: attempts >= RETRY_POLICY.maxAttempts && result.outcome !== "REJECTED"
                ? "ATTEMPTS_EXHAUSTED"
                : failureCode,
            sentAt: null,
        };
    }
    // O indice e o numero de tentativas ja feitas menos a primeira; a ultima
    // espera se repete se algum dia `maxAttempts` crescer sem o backoff crescer.
    const wait = RETRY_POLICY.backoffMinutes[attempts - 1] ??
        RETRY_POLICY.backoffMinutes[RETRY_POLICY.backoffMinutes.length - 1];
    return {
        ...base,
        status: "PLANNED",
        nextAttemptAt: addMinutes(now, wait),
        failureCode,
        sentAt: null,
    };
}
