import type { ID, ISODateString, TenantScopedEntity } from "./common";

/**
 * Hierarquia de regras.
 *
 * A especificacao descreve tres niveis na INTERFACE (fundamentais, do
 * profissional, contextuais) e seis camadas de PRECEDENCIA. Modelamos as seis
 * camadas, porque e a precedencia que o motor precisa resolver; a interface
 * agrupa `SECURITY` + `SYSTEM` como "regras fundamentais".
 *
 * Menor numero em `RULE_LEVEL_PRECEDENCE` = maior prioridade. Uma regra de
 * nivel inferior nunca sobrescreve uma superior — isso e verificado no motor,
 * nao apenas por convencao.
 */
export const RULE_LEVELS = [
  "SECURITY",
  "SYSTEM",
  "PROFESSION",
  "PROFESSIONAL",
  "CONTEXTUAL",
  "PREFERENCE",
] as const;

export type RuleLevel = (typeof RULE_LEVELS)[number];

export const RULE_LEVEL_PRECEDENCE: Record<RuleLevel, number> = {
  SECURITY: 0,
  SYSTEM: 1,
  PROFESSION: 2,
  PROFESSIONAL: 3,
  CONTEXTUAL: 4,
  PREFERENCE: 5,
};

/** Niveis que o profissional pode criar, editar ou desativar. */
export const USER_EDITABLE_RULE_LEVELS: readonly RuleLevel[] = [
  "PROFESSIONAL",
  "CONTEXTUAL",
  "PREFERENCE",
];

export const RULE_CATEGORIES = [
  "SAFETY",
  "IDENTITY",
  "PRIVACY",
  "PRICING",
  "SCHEDULING",
  "CONFIRMATION",
  "RESCHEDULING",
  "CANCELLATION",
  "LOCATION",
  "AVAILABILITY",
  "SERVICES",
  "PAYMENT",
  "ESCALATION",
  "TONE",
  "GENERAL",
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

/** Campos que uma condicao pode inspecionar no contexto da decisao. */
export const RULE_CONDITION_FIELDS = [
  "message.classification",
  "message.intent",
  "message.channel",
  "client.modality",
  "client.status",
  "client.hasOutstandingBalance",
  "appointment.status",
  "context.dayOfWeek",
  "context.hour",
  "context.withinBusinessHours",
  "agent.confidence",
] as const;

export type RuleConditionField = (typeof RULE_CONDITION_FIELDS)[number];

export type RuleConditionOperator =
  | "EQUALS"
  | "NOT_EQUALS"
  | "IN"
  | "NOT_IN"
  | "GREATER_THAN"
  | "LESS_THAN"
  | "IS_TRUE"
  | "IS_FALSE";

export type RuleConditionValue =
  string | number | boolean | string[] | number[];

export interface RuleCondition {
  field: RuleConditionField;
  operator: RuleConditionOperator;
  value: RuleConditionValue;
}

export interface RuleConditionGroup {
  combinator: "AND" | "OR";
  conditions: RuleCondition[];
}

export const RULE_ACTION_TYPES = [
  "ALLOW_TOPIC",
  "DENY_TOPIC",
  "PROVIDE_INFO",
  "AUTO_RESPONSE",
  "REQUIRE_HUMAN_APPROVAL",
  "ESCALATE",
  "CREATE_ALERT",
  "BLOCK",
  "TAG_CONVERSATION",
] as const;

export type RuleActionType = (typeof RULE_ACTION_TYPES)[number];

export interface RuleAction {
  type: RuleActionType;
  /** Conteudo da acao: texto informado, tag aplicada, prioridade do alerta. */
  payload: Record<string, string | number | boolean> | null;
}

export type RuleSource =
  "SYSTEM" | "PROFESSION_TEMPLATE" | "MANUAL" | "NATURAL_LANGUAGE";

export interface AIRule extends TenantScopedEntity {
  /** `null` = regra valida para toda a organizacao. */
  professionalId: ID | null;
  name: string;
  description: string;
  level: RuleLevel;
  category: RuleCategory;
  enabled: boolean;
  /** Desempate entre regras do mesmo nivel. Maior numero decide primeiro. */
  priority: number;
  conditions: RuleConditionGroup;
  actions: RuleAction[];
  source: RuleSource;
  /**
   * Regras imutaveis (SECURITY/SYSTEM) nao podem ser editadas nem desativadas
   * pela interface — e as Security Rules recusam a escrita.
   */
  immutable: boolean;
  /** Incrementado a cada alteracao; citado na auditoria de cada decisao. */
  version: number;
  /** Texto original quando a regra nasceu de linguagem natural. */
  naturalLanguageInput: string | null;
  lastAppliedAt: ISODateString | null;
}

/**
 * Rascunho produzido pela interpretacao de linguagem natural. Ainda NAO e uma
 * regra: precisa passar pelo validador (`src/lib/rules/validation.ts`) e por
 * confirmacao humana antes de virar `AIRule`.
 */
export interface RuleDraft {
  name: string;
  description: string;
  category: RuleCategory;
  conditions: RuleConditionGroup;
  actions: RuleAction[];
  confidence: number;
  warnings: string[];
  sourceText: string;
}
