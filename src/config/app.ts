/** Identidade e constantes globais do produto. */

export const APP_NAME = "Atendara";

export const AI_ASSISTANT_NAME = "Dara";

export const APP_TAGLINE = "Mais tempo para atender.";

export const APP_DESCRIPTION =
  "Agenda, clientes e financeiro em um só lugar, com Dara, sua assistente de IA para a rotina administrativa. A IA auxilia, o humano decide.";

/**
 * Versao do motor de decisao, gravada em cada `AIDecision`. Incrementar sempre
 * que a logica de classificacao ou de precedencia mudar, para que decisoes
 * antigas continuem interpretaveis.
 */
export const AI_ENGINE_VERSION = "0.2.0";

/** Confianca minima padrao para resposta automatica. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";
export const DEFAULT_LOCALE = "pt-BR";
