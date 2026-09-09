import { z } from "zod";

import {
  RULE_ACTION_TYPES,
  RULE_CATEGORIES,
  RULE_CONDITION_FIELDS,
  RULE_LEVELS,
  USER_EDITABLE_RULE_LEVELS,
  type RuleLevel,
} from "@/types";

/**
 * Validacao de regra.
 *
 * A interpretacao de linguagem natural pode errar, e a interface pode ser
 * contornada. Este e o portao pelo qual toda regra passa antes de existir — a
 * validacao acontece no sistema, nao na confianca de quem escreveu.
 */

const conditionSchema = z.object({
  field: z.enum(RULE_CONDITION_FIELDS),
  operator: z.enum([
    "EQUALS",
    "NOT_EQUALS",
    "IN",
    "NOT_IN",
    "GREATER_THAN",
    "LESS_THAN",
    "IS_TRUE",
    "IS_FALSE",
  ]),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
  ]),
});

const conditionGroupSchema = z.object({
  combinator: z.enum(["AND", "OR"]),
  conditions: z.array(conditionSchema).max(10, "No maximo 10 condicoes."),
});

const actionSchema = z.object({
  type: z.enum(RULE_ACTION_TYPES),
  payload: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .nullable(),
});

export const ruleInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Nome muito curto.")
    .max(80, "Nome muito longo."),
  description: z.string().trim().max(400, "Descricao muito longa."),
  level: z.enum(RULE_LEVELS),
  category: z.enum(RULE_CATEGORIES),
  enabled: z.boolean(),
  priority: z
    .number()
    .int("Prioridade deve ser um numero inteiro.")
    .min(0)
    .max(1000),
  conditions: conditionGroupSchema,
  actions: z.array(actionSchema).min(1, "Informe ao menos uma acao."),
  source: z.enum([
    "SYSTEM",
    "PROFESSION_TEMPLATE",
    "MANUAL",
    "NATURAL_LANGUAGE",
  ]),
  naturalLanguageInput: z.string().nullable(),
  professionalId: z.string().nullable(),
});

export type ValidatedRuleInput = z.infer<typeof ruleInputSchema>;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Acoes reservadas ao sistema: liberar isso ao usuario furaria a hierarquia. */
const SYSTEM_ONLY_ACTIONS = new Set(["BLOCK", "REQUIRE_HUMAN_APPROVAL"]);

export function validateRuleInput(input: unknown): ValidationResult {
  const parsed = ruleInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const errors: string[] = [];
  const rule = parsed.data;

  if (!USER_EDITABLE_RULE_LEVELS.includes(rule.level as RuleLevel)) {
    errors.push(
      "Somente regras do profissional, contextuais e de preferencia podem ser criadas.",
    );
  }

  if (rule.actions.some((action) => SYSTEM_ONLY_ACTIONS.has(action.type))) {
    errors.push("Esta acao e reservada as regras fundamentais do sistema.");
  }
  if (rule.source === "SYSTEM" || rule.source === "PROFESSION_TEMPLATE") {
    errors.push("A origem desta regra e reservada ao sistema.");
  }
  for (const action of rule.actions) {
    const price = action.payload?.priceInCents;
    if (
      price !== undefined &&
      (typeof price !== "number" || !Number.isSafeInteger(price) || price < 0)
    ) {
      errors.push(
        "O preco deve ser um valor inteiro em centavos, maior ou igual a zero.",
      );
    }
    const duration = action.payload?.durationMinutes;
    if (
      duration !== undefined &&
      (typeof duration !== "number" ||
        !Number.isInteger(duration) ||
        duration <= 0)
    ) {
      errors.push("A duracao deve ser um numero inteiro positivo de minutos.");
    }
  }

  // Uma regra contextual sem condicao e, na pratica, uma regra geral disfarcada
  // — e passaria a valer em situacoes que o usuario nao previu.
  if (rule.level === "CONTEXTUAL" && rule.conditions.conditions.length === 0) {
    errors.push("Uma regra contextual precisa de ao menos uma condicao.");
  }

  if (
    rule.conditions.conditions.some(
      (condition) =>
        (condition.operator === "IN" || condition.operator === "NOT_IN") &&
        !Array.isArray(condition.value),
    )
  ) {
    errors.push("Os operadores IN e NOT_IN exigem uma lista de valores.");
  }

  return { valid: errors.length === 0, errors };
}
