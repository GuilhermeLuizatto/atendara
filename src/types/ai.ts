import type { MessageClassificationId } from "./classification";
import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { AttentionLevel } from "./conversation";
import type { PrivacyRedactionMark } from "./privacy";
import type { RuleLevel } from "./rules";

export type AIActionTaken =
  | "AUTO_RESPONSE"
  | "SUGGEST_RESPONSE"
  | "ESCALATE_TO_PROFESSIONAL"
  | "CREATE_ALERT"
  | "NO_ACTION"
  | "BLOCKED";

/** Como uma regra participou da decisao — o "porque" auditavel. */
export type AppliedRuleOutcome =
  "MATCHED" | "NOT_MATCHED" | "BLOCKED_BY_HIGHER_LEVEL" | "DISABLED";

export interface AppliedRuleRef {
  ruleId: ID;
  ruleName: string;
  ruleVersion: number;
  level: RuleLevel;
  outcome: AppliedRuleOutcome;
}

/**
 * Registro imutavel de uma decisao do agente. Toda resposta automatica e todo
 * escalonamento produzem exatamente um `AIDecision` — sem excecao. E isso que
 * torna o comportamento do agente auditavel em vez de opaco.
 */
export interface AIDecision extends TenantScopedEntity {
  conversationId: ID;
  messageId: ID;
  clientId: ID | null;
  professionalId: ID | null;
  /** Texto avaliado. Truncado; nao substitui a mensagem original. */
  inputPreview: string;
  classification: MessageClassificationId;
  confidence: number;
  appliedRules: AppliedRuleRef[];
  action: AIActionTaken;
  responseText: string | null;
  /** Justificativa legivel por humanos, exibida na auditoria. */
  reason: string;
  attention: AttentionLevel;
  escalated: boolean;
  /** Versao do motor que produziu a decisao. */
  engineVersion: string;
  decidedAt: ISODateString;
  /** Relogio escolhido no simulador; separado do instante real de registro. */
  evaluatedAt?: ISODateString;
  latencyMs: number;
  /** Sem texto pessoal; permite distinguir modelo, falha e guarda local na trilha. */
  classifier?: {
    provider: "LOCAL" | "GEMINI";
    status: "DISABLED" | "LOCAL_GUARD" | "SUCCEEDED" | "LIMITED" | "UNAVAILABLE";
    model: string | null;
    promptVersion: string | null;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    latencyMs: number;
  };
  /**
   * Presente quando o backend retirou o conteudo pessoal a pedido do titular.
   * Classificacao, regras, acao e motivo continuam os originais.
   */
  privacyRedaction?: PrivacyRedactionMark | null;
}

export type ClassifierStatus = NonNullable<AIDecision["classifier"]>["status"];

/** `NOT_RECORDED`: decisao anterior ao registro do classificador. */
export type ClassifierUsageStatus = ClassifierStatus | "NOT_RECORDED";

export const DECISION_REVIEW_VERDICTS = ["CORRECT", "INCORRECT"] as const;

export type DecisionReviewVerdict = (typeof DECISION_REVIEW_VERDICTS)[number];

/**
 * Revisao humana da classificacao de uma decisao. E a unica referencia de
 * acerto que o painel tem: sem ela, "acerto" seria a confianca do proprio
 * classificador.
 *
 * Mora fora de `aiDecisions` porque aquela colecao e append-only (regra 6) —
 * revisar nao reescreve o registro. O id e o da decisao: uma revisao por
 * decisao, e corrigir a revisao substitui a anterior, com trilha em
 * `auditLogs`. Nao guarda texto: so ids e enums.
 */
export interface AIDecisionReview extends TenantScopedEntity {
  decisionId: ID;
  verdict: DecisionReviewVerdict;
  /** Classificacao que deveria ter saido. `null` quando o veredito e `CORRECT`. */
  expectedClassification: MessageClassificationId | null;
}

/** Entrada do motor de decisao. Nao contem nada especifico de profissao. */
export interface DecisionContext {
  organizationId: ID;
  professionalId: ID | null;
  conversationId: ID;
  clientId: ID;
  messageId: ID;
  text: string;
  channel: string;
  /** Momento da avaliacao, usado por condicoes de horario/dia. */
  evaluatedAt: ISODateString;
  clientModality: string | null;
  clientStatus: string | null;
  clientHasOutstandingBalance: boolean;
}

/** Saida do motor antes de virar `AIDecision` persistida. */
export interface DecisionOutcome {
  classification: MessageClassificationId;
  confidence: number;
  action: AIActionTaken;
  responseText: string | null;
  reason: string;
  attention: AttentionLevel;
  escalated: boolean;
  appliedRules: AppliedRuleRef[];
  engineVersion: string;
}
