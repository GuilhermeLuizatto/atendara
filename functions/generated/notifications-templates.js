// Gerado por scripts/build-functions.mjs.
import { FORBIDDEN_TEMPLATE_TERMS, TEMPLATE_VARIABLES, } from "./notifications-config.js";
import { err, ok, } from "./types.js";
/** O que cada grau de exposicao autoriza interpolar. */
const ALLOWED_BY_DISCLOSURE = {
    TIME_ONLY: ["clientName", "organizationName", "date", "time"],
    TIME_AND_PROFESSIONAL: [
        "clientName",
        "organizationName",
        "professionalName",
        "date",
        "time",
    ],
    TIME_PROFESSIONAL_AND_SERVICE: TEMPLATE_VARIABLES,
};
const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;
/** Sem acento e em minusculas: o modelo e digitado por gente. */
function fold(text) {
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}
function hasForbiddenTerm(text) {
    const folded = fold(text);
    return FORBIDDEN_TEMPLATE_TERMS.some((term) => folded.includes(term));
}
export function renderTemplate(template, context, options) {
    if (!template.trim())
        return err("EMPTY");
    if (hasForbiddenTerm(template))
        return err("FORBIDDEN_TERM");
    const allowed = new Set(ALLOWED_BY_DISCLOSURE[options.disclosure]);
    const known = new Set(TEMPLATE_VARIABLES);
    let rejection = null;
    const body = template
        .replace(PLACEHOLDER, (match, name) => {
        if (!known.has(name)) {
            rejection ??= "UNKNOWN_VARIABLE";
            return match;
        }
        if (!allowed.has(name)) {
            rejection ??= "DISCLOSURE_EXCEEDED";
            return match;
        }
        return context[name];
    })
        .replace(/\s+/g, " ")
        .trim();
    if (rejection)
        return err(rejection);
    if (!body)
        return err("EMPTY");
    if (hasForbiddenTerm(body))
        return err("FORBIDDEN_TERM");
    if (body.length > options.maxBodyLength)
        return err("TOO_LONG");
    return ok(body);
}
/**
 * Impressao digital do texto enviado.
 *
 * FNV-1a de 32 bits: deterministico, sem SDK e sem `crypto` — o dominio precisa
 * rodar igual no navegador, no Node e no teste. Nao e hash criptografico e nao
 * precisa ser: o objetivo e comparar duas tentativas ("mandaram o mesmo texto?")
 * sem guardar o texto, nao resistir a adversario.
 */
export function hashBody(body) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < body.length; index += 1) {
        hash ^= body.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}
