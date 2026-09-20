// Gerado por scripts/build-functions.mjs.
/**
 * Avaliacao de condicoes.
 *
 * Regras sao dados estruturados, nao texto livre enviado a um modelo. Isso
 * torna a decisao reproduzivel, testavel e explicavel: dado o mesmo contexto,
 * a mesma regra sempre decide igual, e da para mostrar exatamente qual condicao
 * casou.
 */
export function evaluateCondition(condition, context) {
    const actual = context[condition.field];
    const expected = condition.value;
    switch (condition.operator) {
        case "EQUALS":
            return actual === expected;
        case "NOT_EQUALS":
            return actual !== expected;
        case "IN":
            return Array.isArray(expected)
                ? expected.includes(actual)
                : false;
        case "NOT_IN":
            return Array.isArray(expected)
                ? !expected.includes(actual)
                : false;
        case "GREATER_THAN":
            return (typeof actual === "number" &&
                typeof expected === "number" &&
                actual > expected);
        case "LESS_THAN":
            return (typeof actual === "number" &&
                typeof expected === "number" &&
                actual < expected);
        case "IS_TRUE":
            return actual === true;
        case "IS_FALSE":
            return actual === false;
    }
}
/**
 * Grupo sem condicoes casa sempre.
 *
 * E o caso das regras fundamentais, que valem incondicionalmente. Tratar isso
 * como "nao casou" faria uma regra de seguranca ser silenciosamente ignorada —
 * exatamente o tipo de falha que o produto nao pode ter.
 */
export function evaluateGroup(group, context) {
    if (group.conditions.length === 0)
        return true;
    return group.combinator === "AND"
        ? group.conditions.every((condition) => evaluateCondition(condition, context))
        : group.conditions.some((condition) => evaluateCondition(condition, context));
}
