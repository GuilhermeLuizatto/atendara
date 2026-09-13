// Gerado por scripts/build-functions.mjs.
import { CHANNEL_META } from "./notifications-config.js";
/**
 * Validacao de destino.
 *
 * Um contato guardado no cadastro e um dado de contato — nao e prova de que o
 * canal aceita aquele destino, e muito menos de que a organizacao pode escrever
 * para ele. Este arquivo responde so a primeira pergunta: o destino tem forma
 * valida para o canal? Consentimento e habilitacao de remetente sao decididos
 * em `eligibility.ts`.
 *
 * Telefone e normalizado para E.164 porque e o formato que provedores de SMS e
 * WhatsApp exigem. Um numero anotado como "(13) 99664-9260" nao e recusado — e
 * completado com o codigo do Brasil, e a suposicao fica registrada no retorno,
 * para que a interface possa pedir confirmacao em vez de adivinhar em silencio.
 */
const BRAZIL_COUNTRY_CODE = "55";
/** E.164: "+" seguido de 8 a 15 digitos, o primeiro diferente de zero. */
const E164 = /^\+[1-9]\d{7,14}$/;
/** Local simples, dominio com pelo menos um ponto e TLD alfabetico. */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export function normalizePhone(raw) {
    if (!raw)
        return null;
    const trimmed = raw.trim();
    const hasPlus = trimmed.startsWith("+");
    const digits = trimmed.replace(/\D/g, "");
    if (!digits)
        return null;
    if (hasPlus) {
        const e164 = `+${digits}`;
        return E164.test(e164) ? { e164, countryAssumed: false } : null;
    }
    // Ja veio com o codigo do pais colado, sem "+": 55 + DDD + 8 ou 9 digitos.
    if (digits.startsWith(BRAZIL_COUNTRY_CODE) && (digits.length === 12 || digits.length === 13)) {
        const e164 = `+${digits}`;
        return E164.test(e164) ? { e164, countryAssumed: false } : null;
    }
    // DDD + numero, do jeito que se anota no Brasil.
    if (digits.length === 10 || digits.length === 11) {
        const e164 = `+${BRAZIL_COUNTRY_CODE}${digits}`;
        return E164.test(e164) ? { e164, countryAssumed: true } : null;
    }
    return null;
}
export function isValidEmail(raw) {
    return !!raw && EMAIL.test(raw.trim()) && raw.trim().length <= 254;
}
/**
 * Destino do canal a partir do cadastro, ja normalizado.
 *
 * `null` significa "nao da para enviar" — sem contato ou com contato que o canal
 * nao aceita. Quem chama distingue os dois casos olhando o campo de origem.
 */
export function contactFor(client, channel) {
    if (CHANNEL_META[channel].contactField === "email") {
        const email = client.email?.trim() ?? "";
        if (!isValidEmail(email))
            return null;
        return { destination: email, hint: maskEmail(email), countryAssumed: false };
    }
    const phone = normalizePhone(client.phone);
    if (!phone)
        return null;
    return {
        destination: phone.e164,
        hint: maskPhone(phone.e164),
        countryAssumed: phone.countryAssumed,
    };
}
/** Existe contato bruto no cadastro, valido ou nao. Separa "falta" de "invalido". */
export function hasRawContact(client, channel) {
    const field = CHANNEL_META[channel].contactField;
    return !!(field === "email" ? client.email?.trim() : client.phone?.trim());
}
/**
 * O registro de entrega guarda apenas o suficiente para alguem conferir "foi
 * para o contato certo?" sem que a trilha vire uma segunda agenda de contatos.
 */
export function maskPhone(e164) {
    return `***${e164.slice(-4)}`;
}
export function maskEmail(email) {
    const at = email.lastIndexOf("@");
    return at < 0 ? "***" : `***${email.slice(at)}`;
}
