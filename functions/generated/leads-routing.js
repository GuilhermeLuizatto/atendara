// Gerado por scripts/build-functions.mjs.
import { CLASSIFICATION_ROUTING, INTENT_ROUTING } from "./leads-config.js";
/**
 * Para qual fila interna vai o contato, sem I/O.
 *
 * A fila sai da classificação que o motor já fez — nunca de uma segunda
 * leitura do texto — e das tabelas de `config/leads.ts`. A ordem importa:
 * risco, urgência e conteúdo sensível vêm da classificação e passam na frente
 * de qualquer intenção; dúvida e baixa confiança vencem a intenção
 * administrativa, porque encaminhar errado para uma fila automática é pior do
 * que entregar a gente.
 */
export function routeContact(input) {
    const { classification, confidenceThreshold } = input;
    const byClassification = CLASSIFICATION_ROUTING[classification.classification];
    if (byClassification !== "BY_INTENT")
        return byClassification;
    if (classification.ambiguous) {
        return { queue: "HUMAN_REVIEW", reason: "AMBIGUOUS", requiresHuman: true };
    }
    // `!(a >= b)` e não `a < b`: limite inválido (NaN) também manda para gente.
    if (!(classification.confidence >= confidenceThreshold)) {
        return { queue: "HUMAN_REVIEW", reason: "LOW_CONFIDENCE", requiresHuman: true };
    }
    return INTENT_ROUTING[classification.intent];
}
