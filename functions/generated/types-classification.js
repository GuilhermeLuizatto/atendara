// Gerado por scripts/build-functions.mjs.
/**
 * Taxonomia de classificacao de mensagens.
 *
 * O nucleo define um conjunto base; cada profissao seleciona quais rotulos
 * usa (`ProfessionConfig.messageClassifications`). Nao existe `if (profissao)`
 * no motor de decisao: ele consulta esta metadata.
 */
export const MESSAGE_CLASSIFICATIONS = [
    "ADMINISTRATIVE",
    "PROFESSIONAL",
    "CLINICAL",
    "TRAINING",
    "HEALTH_RELATED",
    "URGENT",
    "FINANCIAL",
    "POSSIBLE_RISK",
    "UNKNOWN",
];
/** Conjunto base obrigatorio, presente em todas as profissoes. */
export const BASE_MESSAGE_CLASSIFICATIONS = ["ADMINISTRATIVE", "PROFESSIONAL", "POSSIBLE_RISK", "UNKNOWN"];
