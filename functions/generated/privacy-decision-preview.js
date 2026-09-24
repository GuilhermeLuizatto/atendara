// Gerado por scripts/build-functions.mjs.
import { DECISION_INPUT_PREVIEW_CHARS } from "./privacy-config.js";
/**
 * Trecho da mensagem que a decisao do agente guarda. Vazio quando a profissao
 * nao guarda nenhum: a trilha nao pode virar uma segunda copia do que o
 * paciente escreveu.
 */
export function decisionInputPreview(body, profile) {
    return body.slice(0, DECISION_INPUT_PREVIEW_CHARS[profile]);
}
