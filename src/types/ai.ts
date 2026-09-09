import type { MessageClassificationId } from "./classification";
import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { AttentionLevel } from "./conversation";
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
  clientId: ID;
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
