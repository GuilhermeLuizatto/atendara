import type { AIDecision, MessageClassificationId } from "@/types";

export function summarizeDecisions(
  decisions: readonly AIDecision[],
  filter: {
    organizationId: string;
    from: Date;
    until: Date;
    professionalId?: string;
  },
) {
  const seen = new Set<string>();
  const rows = decisions.filter((decision) => {
    const at = Date.parse(decision.decidedAt);
    if (
      decision.organizationId !== filter.organizationId ||
      seen.has(decision.id) ||
      !Number.isFinite(at) ||
      at < filter.from.getTime() ||
      at > filter.until.getTime() ||
      (filter.professionalId &&
        decision.professionalId !== filter.professionalId)
    )
      return false;
    seen.add(decision.id);
    return true;
  });
  const classifications: Partial<Record<MessageClassificationId, number>> = {};
  const rules = new Map<
    string,
    { id: string; name: string; version: number; matches: number }
  >();
  for (const row of rows) {
    classifications[row.classification] =
      (classifications[row.classification] ?? 0) + 1;
    for (const rule of row.appliedRules.filter(
      (rule) => rule.outcome === "MATCHED",
    )) {
      const key = `${rule.ruleId}:${rule.ruleVersion}`;
      const aggregate = rules.get(key) ?? {
        id: rule.ruleId,
        name: rule.ruleName,
        version: rule.ruleVersion,
        matches: 0,
      };
      aggregate.matches++;
      rules.set(key, aggregate);
    }
  }
  const latencies = rows
    .map((row) => row.latencyMs)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const scores = rows
    .map((row) => row.confidence)
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 1);
  const automatic = rows.filter((row) => row.action === "AUTO_RESPONSE").length;
  return {
    total: rows.length,
    automatic,
    suggested: rows.filter((row) => row.action === "SUGGEST_RESPONSE").length,
    escalated: rows.filter((row) => row.escalated).length,
    critical: rows.filter((row) => row.attention === "CRITICAL").length,
    automaticRate: rows.length ? automatic / rows.length : null,
    averageConfidence: scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null,
    p95LatencyMs: latencies.length
      ? latencies[Math.ceil(latencies.length * 0.95) - 1]
      : null,
    classifications,
    rules: [...rules.values()].sort(
      (a, b) => b.matches - a.matches || a.id.localeCompare(b.id),
    ),
  };
}
