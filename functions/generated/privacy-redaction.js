// Gerado por scripts/build-functions.mjs.
import { MASKED_CONTACT, PSEUDONYM_PREFIX, REDACTED_NAME, REDACTED_TEXT, } from "./privacy-config.js";
/** O pseudonimo nao deriva do `clientId`: quem tem o id antigo nao o recalcula. */
export function pseudonymFrom(randomId) {
    return `${PSEUDONYM_PREFIX}${randomId}`;
}
export function isPseudonym(value) {
    return typeof value === "string" && value.startsWith(PSEUDONYM_PREFIX);
}
function readPath(data, path) {
    return path.split(".").reduce((current, key) => current && typeof current === "object"
        ? current[key]
        : undefined, data);
}
function pseudonymized(value, context) {
    if (typeof value !== "string" || isPseudonym(value))
        return value;
    return context.pseudonymOf(value) ?? value;
}
function replace(replacement, value, data, path, context) {
    switch (replacement) {
        case "CLIENT_ID":
            return pseudonymized(value, context);
        case "CLIENT_RESOURCE_ID": {
            // Na trilha, `resource.id` aponta para atendimento, lancamento, conversa.
            // So o id de cadastro de cliente e do titular.
            const parent = path.split(".").slice(0, -1).join(".");
            return readPath(data, `${parent}.type`) === "client"
                ? pseudonymized(value, context)
                : value;
        }
        case "REDACTED_TEXT":
            return typeof value === "string" ? REDACTED_TEXT : value;
        case "REDACTED_NAME":
            return typeof value === "string" ? REDACTED_NAME : value;
        case "MASKED_CONTACT":
            return typeof value === "string" ? MASKED_CONTACT : value;
        case "NULL":
            return null;
    }
}
/**
 * Patch de pseudonimizacao, ou `null` quando o tratamento nao pseudonimiza ou
 * quando este mesmo pedido ja passou pelo documento. Todo patch leva a marca,
 * inclusive quando nenhum campo mudou: a trilha registra que foi conferida.
 */
export function redactionPatch(treatment, data, context) {
    if (treatment.action !== "PSEUDONYMIZE")
        return null;
    const previous = data.privacyRedaction;
    if (previous?.requestId === context.mark.requestId)
        return null;
    const patch = {};
    for (const [path, replacement] of Object.entries(treatment.fields)) {
        const current = readPath(data, path);
        if (current === undefined)
            continue;
        const next = replace(replacement, current, data, path, context);
        if (next !== current)
            patch[path] = next;
    }
    patch.privacyRedaction = context.mark;
    return patch;
}
/** O documento como fica depois do patch, com chaves de ponto aninhadas. */
export function applyRedactionPatch(data, patch) {
    const result = structuredClone(data);
    for (const [path, value] of Object.entries(patch)) {
        const keys = path.split(".");
        let target = result;
        for (const key of keys.slice(0, -1)) {
            const next = target[key];
            target[key] = next && typeof next === "object" ? next : {};
            target = target[key];
        }
        target[keys[keys.length - 1]] = value;
    }
    return result;
}
