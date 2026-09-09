import {
  RULE_LEVEL_PRECEDENCE,
  type AIRule,
  type AppliedRuleRef,
  type RuleActionType,
} from "@/types";

import type { EvaluationContext } from "./context";
import { evaluateGroup } from "./evaluate";

/**
 * Ordena por precedencia: nivel primeiro (menor numero decide antes), prioridade
 * depois. E a ordem em que o motor percorre as regras, entao uma regra do
 * profissional nunca e avaliada antes de uma regra fundamental.
 */
export function sortByPrecedence(rules: AIRule[]): AIRule[] {
  return [...rules].sort(
    (a, b) =>
      RULE_LEVEL_PRECEDENCE[a.level] - RULE_LEVEL_PRECEDENCE[b.level] ||
      b.priority - a.priority ||
      a.name.localeCompare(b.name),
  );
}

export interface RuleEvaluation {
  rule: AIRule;
  matched: boolean;
  /** Bloqueada por uma regra de nivel superior que negou o mesmo assunto. */
  blocked: boolean;
}

export interface PrecedenceResult {
  evaluations: RuleEvaluation[];
  /** Regras que casaram e nao foram bloqueadas, ja em ordem de precedencia. */
  effective: AIRule[];
  trail: AppliedRuleRef[];
}

function actionTypes(rule: AIRule): RuleActionType[] {
  return rule.actions.map((action) => action.type);
}

function topicOf(rule: AIRule): string {
  const withTopic = rule.actions.find(
    (action) => action.payload && "topic" in action.payload,
  );
  return String(withTopic?.payload?.topic ?? rule.category);
}

/**
 * Percorre as regras em ordem de precedencia e resolve o conflito entre elas.
 *
 * A garantia central: se uma regra de nivel superior NEGA um assunto, nenhuma
 * regra inferior consegue liberar o mesmo assunto. A inferior aparece na trilha
 * como `BLOCKED_BY_HIGHER_LEVEL` — nao some, porque a auditoria precisa mostrar
 * que ela existia e por que nao valeu.
 */
export function resolvePrecedence(
  rules: AIRule[],
  context: EvaluationContext,
): PrecedenceResult {
  const ordered = sortByPrecedence(rules);
  const deniedTopics = new Set<string>();
  const evaluations: RuleEvaluation[] = [];
  const trail: AppliedRuleRef[] = [];
  const effective: AIRule[] = [];

  for (const rule of ordered) {
    if (!rule.enabled) {
      trail.push(toRef(rule, "DISABLED"));
      evaluations.push({ rule, matched: false, blocked: false });
      continue;
    }

    const matched = evaluateGroup(rule.conditions, context);
    if (!matched) {
      trail.push(toRef(rule, "NOT_MATCHED"));
      evaluations.push({ rule, matched: false, blocked: false });
      continue;
    }

    const topic = topicOf(rule);
    const types = actionTypes(rule);
    const isAllow =
      types.includes("ALLOW_TOPIC") ||
      types.includes("PROVIDE_INFO") ||
      types.includes("AUTO_RESPONSE");

    if (isAllow && deniedTopics.has(topic)) {
      trail.push(toRef(rule, "BLOCKED_BY_HIGHER_LEVEL"));
      evaluations.push({ rule, matched: true, blocked: true });
      continue;
    }

    if (types.includes("DENY_TOPIC") || types.includes("BLOCK")) {
      deniedTopics.add(topic);
    }

    trail.push(toRef(rule, "MATCHED"));
    evaluations.push({ rule, matched: true, blocked: false });
    effective.push(rule);
  }

  return { evaluations, effective, trail };
}

function toRef(
  rule: AIRule,
  outcome: AppliedRuleRef["outcome"],
): AppliedRuleRef {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleVersion: rule.version,
    level: rule.level,
    outcome,
  };
}
