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
        .replace(/\s+/g, " ")
        .toUpperCase();
}
/**
 * Telefone da Meta (só dígitos, com país) para o formato do cadastro (`+`).
 * Sem heurística de DDI: o que não parece telefone volta `null`, e número que
 * não normaliza não encontra ninguém — o que é melhor do que encontrar a pessoa
 * errada.
 */
export function normalizeInboundPhone(value) {
    if (!/^\+?[\d\s()-]+$/.test(value))
        return null;
    const digits = value.replace(/\D/g, "");
    if (!/^[1-9]\d{7,14}$/.test(digits))
        return null;
    return `+${digits}`;
}
/**
 * Lê o corpo do webhook da Meta. Tudo o que não for mensagem de texto ou
 * resposta de botão é ignorado. O aceite da API não comprova entrega: eventos
 * de status precisam de tratamento próprio, separado das mensagens recebidas.
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
            if (typeof providerSenderId !== "string" ||
                !Array.isArray(value?.messages))
                continue;
            for (const message of value.messages) {
                if (typeof message !== "object" || message === null)
                    continue;
                const raw = message;
                const from = typeof raw.from === "string" ? raw.from : null;
                const id = typeof raw.id === "string" ? raw.id : null;
                const seconds = typeof raw.timestamp === "string" && /^\d+$/.test(raw.timestamp)
                    ? Number(raw.timestamp)
                    : NaN;
                const instant = new Date(seconds * 1000);
                if (!from ||
                    !normalizeInboundPhone(from) ||
                    !id ||
                    !/^[\x21-\x7e]{1,256}$/.test(id) ||
                    !Number.isSafeInteger(seconds) ||
                    seconds <= 0 ||
                    !Number.isFinite(instant.getTime()))
                    continue;
                const sentAt = instant.toISOString();
                if (raw.type === "text") {
                    const text = raw.text?.body;
                    if (typeof text !== "string" || !text.trim())
                        continue;
                    events.push({
                        kind: "TEXT",
                        providerSenderId,
                        from,
                        providerMessageId: id,
                        text: text.trim(),
                        sentAt,
                    });
                    continue;
                }
                if (raw.type === "button") {
                    const payload = raw.button
                        ?.payload;
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
    // Pedido de saída vale mesmo atrasado: quem pediu para parar pediu.
    if (event.kind === "TEXT" && isOptOut(event.text))
        return { kind: "OPT_OUT" };
    if (event.kind === "BUTTON") {
        if (lastInboundAt && Date.parse(event.sentAt) < Date.parse(lastInboundAt))
            return { kind: "OUT_OF_ORDER" };
        return event.button === "CONFIRM"
            ? { kind: "CONFIRM" }
            : { kind: "RESCHEDULE" };
    }
    if (lastInboundAt && Date.parse(event.sentAt) < Date.parse(lastInboundAt)) {
        return { kind: "OUT_OF_ORDER" };
    }
    return { kind: "CLASSIFY" };
}
/**
 * A conversa de WhatsApp de uma pessoa. Por cadastro quando ha vinculo; por
 * numero quando nao ha — numero desconhecido conversa com a clinica sem virar
 * cadastro sozinho. O despachante usa a mesma regra para achar a conversa de
 * uma resposta sem que a tarefa guarde o id dela.
 */
export function whatsappConversationId(clientId, phone) {
    return clientId ? `wa-${clientId}` : `wa-anonimo-${phone}`;
}
/** Identidade estável da mensagem recebida, derivada do id da Meta. */
export function inboundMessageId(providerMessageId) {
    // A codificação preserva a identidade: retirar pontuação ou truncar fundiria
    // mensagens diferentes, descartando uma delas como reentrega.
    return `wa-${encodeURIComponent(providerMessageId)}`;
}
