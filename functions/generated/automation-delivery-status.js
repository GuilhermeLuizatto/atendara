// Gerado por scripts/build-functions.mjs.
import { metaErrorFailureCode } from "./notifications-providers-meta-cloud-api.js";
const KINDS = {
    sent: "SENT",
    delivered: "DELIVERED",
    read: "READ",
    failed: "FAILED",
};
function errorCodeOf(status) {
    const errors = status.errors;
    if (!Array.isArray(errors))
        return null;
    const code = errors[0]?.code;
    return typeof code === "number" ? code : null;
}
/**
 * Corpo do webhook -> progressos, ignorando o que nao reconhece.
 *
 * Mesma severidade do parser de mensagens: id fora do formato, horario que
 * nao e numero ou estado desconhecido sao descartados em silencio. Um aviso
 * de status perdido nao machuca ninguem; um aviso inventado, sim.
 */
export function parseDeliveryStatuses(data) {
    if (typeof data !== "object" || data === null)
        return [];
    const entries = data.entry;
    if (!Array.isArray(entries))
        return [];
    const events = [];
    for (const entry of entries) {
        const changes = entry?.changes;
        if (!Array.isArray(changes))
            continue;
        for (const change of changes) {
            const value = change?.value;
            const providerSenderId = value?.metadata?.phone_number_id;
            if (typeof providerSenderId !== "string" || !Array.isArray(value?.statuses))
                continue;
            for (const raw of value.statuses) {
                if (typeof raw !== "object" || raw === null)
                    continue;
                const status = raw;
                const id = typeof status.id === "string" ? status.id : null;
                const kind = typeof status.status === "string" ? KINDS[status.status] : undefined;
                const seconds = typeof status.timestamp === "string" && /^\d+$/.test(status.timestamp)
                    ? Number(status.timestamp)
                    : NaN;
                const instant = new Date(seconds * 1000);
                if (!id ||
                    !/^[\x21-\x7e]{1,256}$/.test(id) ||
                    !kind ||
                    !Number.isSafeInteger(seconds) ||
                    seconds <= 0 ||
                    !Number.isFinite(instant.getTime()))
                    continue;
                events.push({
                    providerSenderId,
                    providerMessageId: id,
                    kind,
                    occurredAt: instant.toISOString(),
                    failureCode: kind === "FAILED" ? metaErrorFailureCode(errorCodeOf(status)) : null,
                });
            }
        }
    }
    return events;
}
/**
 * O que o progresso carimba na entrega. `{}` quer dizer "nada a fazer".
 *
 * **Idempotente de proposito:** a Meta reentrega o mesmo aviso, e o primeiro
 * instante registrado e o que vale — carimbar de novo moveria para frente um
 * horario que ja aconteceu. Lida implica entregue, porque as vezes so o
 * segundo aviso chega.
 *
 * `SENT` nao muda nada: quem aceitou o envio ja gravou `sentAt`, e o aviso da
 * Meta chega depois, com horario igual ou posterior.
 */
export function deliveryStatusFields(delivery, event) {
    if (event.kind === "SENT")
        return {};
    if (event.kind === "FAILED") {
        // Entrega ja cancelada ou ja falhada nao muda de motivo: o primeiro
        // registro e o que explica o que aconteceu.
        if (delivery.status === "FAILED" || delivery.status === "CANCELLED")
            return {};
        return { status: "FAILED", failureCode: event.failureCode };
    }
    if (event.kind === "DELIVERED") {
        return delivery.deliveredAt ? {} : { deliveredAt: event.occurredAt };
    }
    return {
        ...(delivery.deliveredAt ? {} : { deliveredAt: event.occurredAt }),
        ...(delivery.readAt ? {} : { readAt: event.occurredAt }),
    };
}
