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
] as const;

export type MessageClassificationId = (typeof MESSAGE_CLASSIFICATIONS)[number];

/** Conjunto base obrigatorio, presente em todas as profissoes. */
export const BASE_MESSAGE_CLASSIFICATIONS: readonly MessageClassificationId[] =
  ["ADMINISTRATIVE", "PROFESSIONAL", "POSSIBLE_RISK", "UNKNOWN"];

/** Tom visual associado a uma classificacao (mapeado para design tokens). */
export type ClassificationTone =
  "neutral" | "informative" | "professional" | "warning" | "critical";

export interface MessageClassificationMeta {
  id: MessageClassificationId;
  label: string;
  description: string;
  tone: ClassificationTone;
  /**
   * Regra fundamental do sistema: apenas classificacoes marcadas como elegiveis
   * podem receber resposta automatica. Todo o resto vai para o profissional.
   */
  autoResponseEligible: boolean;
  /** Forca escalonamento imediato, independente de qualquer regra do usuario. */
  alwaysEscalates: boolean;
  /** Conteudo potencialmente sensivel: nao e copiado para o CRM administrativo. */
  sensitive: boolean;
}
