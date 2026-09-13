// Gerado por scripts/build-functions.mjs.
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
];
export const RULE_LEVEL_PRECEDENCE = {
    SECURITY: 0,
    SYSTEM: 1,
    PROFESSION: 2,
    PROFESSIONAL: 3,
    CONTEXTUAL: 4,
    PREFERENCE: 5,
};
/** Niveis que o profissional pode criar, editar ou desativar. */
export const USER_EDITABLE_RULE_LEVELS = [
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
];
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
];
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
];
