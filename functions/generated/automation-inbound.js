// Gerado por scripts/build-functions.mjs.
import { INBOUND_OPT_OUT_TERMS, INBOUND_WINDOW_HOURS } from "./inbound-config.js";
const BUTTONS = {
    CONFIRMAR: "CONFIRM",
    CONFIRM: "CONFIRM",
    REMARCAR: "RESCHEDULE",
    RESCHEDULE: "RESCHEDULE",
};
/** Sem acento, sem espaço em volta e em maiúsculas: gente digita como quer. */
export function foldInbound(text) {
    return text
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .toUpperCase();
}
/**
 * Telefone da Meta (só dígitos, com país) para o formato do cadastro (`+`).
 * Sem heurística de DDI: o que não parece telefone volta `null`, e número que
 * não normaliza não encontra ninguém — o que é melhor do que encontrar a pessoa
 * errada.
 */
export function normalizeInboundPhone(value) {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15)
        return null;
    return `+${digits}`;
}
/**
 * Lê o corpo do webhook da Meta. Tudo o que não for mensagem de texto ou
 * resposta de botão é descartado em silêncio: status de entrega já volta pela
 * rota do resultado (13.4), e o resto não tem tratamento.
 */
export function parseInboundPayload(data) {
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
            if (typeof providerSenderId !== "string" || !Array.isArray(value?.messages))
                continue;
            for (const message of value.messages) {
                const raw = message;
                const from = typeof raw.from === "string" ? raw.from : null;
                const id = typeof raw.id === "string" ? raw.id : null;
                const seconds = Number(raw.timestamp);
                if (!from || !id || !Number.isFinite(seconds))
                    continue;
                const sentAt = new Date(seconds * 1000).toISOString();
                if (raw.type === "text") {
                    const text = raw.text?.body;
                    if (typeof text !== "string" || !text.trim())
                        continue;
                    events.push({ kind: "TEXT", providerSenderId, from, providerMessageId: id, text: text.trim(), sentAt });
                    continue;
                }
                if (raw.type === "button") {
                    const payload = raw.button?.payload;
                    const label = raw.button?.text;
                    const button = BUTTONS[foldInbound(String(payload ?? label ?? ""))];
                    if (!button)
                        continue;
                    const context = raw.context?.id;
                    events.push({
                        kind: "BUTTON",
                        providerSenderId,
                        from,
                        providerMessageId: id,
                        button,
                        repliedTo: typeof context === "string" ? context : null,
                        sentAt,
                    });
                }
            }
        }
    }
    return events;
}
/** A janela em que o WhatsApp aceita texto livre, aberta pela pessoa. */
export function inboundWindowEndsAt(sentAt) {
    return new Date(Date.parse(sentAt) + INBOUND_WINDOW_HOURS * 3_600_000).toISOString();
}
export function isWithinInboundWindow(windowEndsAt, now) {
    return windowEndsAt !== null && Date.parse(now) < Date.parse(windowEndsAt);
}
/** A pessoa pediu para parar de receber. Vale em qualquer capitalização. */
export function isOptOut(text) {
    return INBOUND_OPT_OUT_TERMS.includes(foldInbound(text));
}
export function decideInbound(input) {
    const { event, knownProviderMessageIds, lastInboundAt } = input;
    // A Meta reentrega o mesmo webhook quando não recebe 200 a tempo. Sem esta
    // trava, uma reentrega viraria segunda mensagem, segunda decisão e segunda
    // resposta automática.
    if (knownProviderMessageIds.includes(event.providerMessageId))
        return { kind: "DUPLICATE" };
    if (event.kind === "BUTTON") {
        return event.button === "CONFIRM" ? { kind: "CONFIRM" } : { kind: "RESCHEDULE" };
    }
    // Pedido de saída vale mesmo atrasado: quem pediu para parar pediu.
    if (isOptOut(event.text))
        return { kind: "OPT_OUT" };
    if (lastInboundAt && Date.parse(event.sentAt) < Date.parse(lastInboundAt)) {
        return { kind: "OUT_OF_ORDER" };
    }
    return { kind: "CLASSIFY" };
}
/** Identidade estável da mensagem recebida, derivada do id da Meta. */
export function inboundMessageId(providerMessageId) {
    return `wa-${providerMessageId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 96)}`;
}
