// Gerado por scripts/build-functions.mjs.
import { RULE_LEVEL_PRECEDENCE, } from "./types.js";
import { evaluateGroup } from "./rules-evaluate.js";
/**
 * Ordena por precedencia: nivel primeiro (menor numero decide antes), prioridade
 * depois. E a ordem em que o motor percorre as regras, entao uma regra do
 * profissional nunca e avaliada antes de uma regra fundamental.
 */
export function sortByPrecedence(rules) {
    return [...rules].sort((a, b) => RULE_LEVEL_PRECEDENCE[a.level] - RULE_LEVEL_PRECEDENCE[b.level] ||
        b.priority - a.priority ||
        a.name.localeCompare(b.name));
}
function actionTypes(rule) {
    return rule.actions.map((action) => action.type);
}
function topicOf(rule) {
    const withTopic = rule.actions.find((action) => action.payload && "topic" in action.payload);
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
export function resolvePrecedence(rules, context) {
    const ordered = sortByPrecedence(rules);
    const deniedTopics = new Set();
    const evaluations = [];
    const trail = [];
    const effective = [];
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
        const isAllow = types.includes("ALLOW_TOPIC") ||
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
function toRef(rule, outcome) {
    return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleVersion: rule.version,
        level: rule.level,
        outcome,
    };
}
