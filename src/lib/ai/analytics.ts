import {
  isConversationReplyEvent,
  type AIDecision,
  type AIDecisionReview,
  type ClassifierUsageStatus,
  type ConversationReplyEvent,
  type DeliveryFailureCode,
  type MessageClassificationId,
  type NotificationDelivery,
} from "@/types";

export interface AnalyticsFilter {
  organizationId: string;
  from: Date;
  until: Date;
  professionalId?: string;
}

function decisionsInWindow(
  decisions: readonly AIDecision[],
  filter: AnalyticsFilter,
): AIDecision[] {
  const seen = new Set<string>();
  return decisions.filter((decision) => {
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
}

export function summarizeDecisions(
  decisions: readonly AIDecision[],
  filter: AnalyticsFilter,
) {
  const rows = decisionsInWindow(decisions, filter);
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

/**
 * Quem produziu a classificacao que valeu. Gemini que falhou ou foi barrado
 * pela guarda local conta como local: a classificacao em vigor nao veio dele.
 */
export type ClassificationSource = "GEMINI" | "LOCAL";

function classificationSource(decision: AIDecision): ClassificationSource {
  return decision.classifier?.status === "SUCCEEDED" ? "GEMINI" : "LOCAL";
}

/**
 * Acerto medido so onde alguem da administracao revisou. Decisao sem revisao
 * fica fora do denominador: contar como acerto seria presumir que o
 * classificador acertou justamente onde ninguem olhou.
 */
export function summarizeReviews(
  decisions: readonly AIDecision[],
  reviews: readonly AIDecisionReview[],
  filter: AnalyticsFilter,
) {
  const byDecision = new Map(
    reviews
      .filter((review) => review.organizationId === filter.organizationId)
      .map((review) => [review.decisionId, review]),
  );
  const rows = decisionsInWindow(decisions, filter);
  const bySource: Record<ClassificationSource, { reviewed: number; correct: number }> = {
    GEMINI: { reviewed: 0, correct: 0 },
    LOCAL: { reviewed: 0, correct: 0 },
  };
  const mistakes = new Map<
    string,
    { predicted: MessageClassificationId; expected: MessageClassificationId; count: number }
  >();
  let reviewed = 0;
  let correct = 0;
  for (const decision of rows) {
    const review = byDecision.get(decision.id);
    if (!review) continue;
    const source = bySource[classificationSource(decision)];
    reviewed++;
    source.reviewed++;
    if (review.verdict === "CORRECT") {
      correct++;
      source.correct++;
    } else if (review.expectedClassification) {
      const key = `${decision.classification}>${review.expectedClassification}`;
      const mistake = mistakes.get(key) ?? {
        predicted: decision.classification,
        expected: review.expectedClassification,
        count: 0,
      };
      mistake.count++;
      mistakes.set(key, mistake);
    }
  }
  const rate = (hits: number, total: number) => (total ? hits / total : null);
  return {
    decisions: rows.length,
    reviewed,
    correct,
    accuracy: rate(correct, reviewed),
    bySource: {
      GEMINI: { ...bySource.GEMINI, accuracy: rate(bySource.GEMINI.correct, bySource.GEMINI.reviewed) },
      LOCAL: { ...bySource.LOCAL, accuracy: rate(bySource.LOCAL.correct, bySource.LOCAL.reviewed) },
    },
    mistakes: [...mistakes.values()].sort(
      (a, b) => b.count - a.count || a.predicted.localeCompare(b.predicted),
    ),
  };
}

export function summarizeClassifier(
  decisions: readonly AIDecision[],
  filter: AnalyticsFilter,
) {
  const statuses: Partial<Record<ClassifierUsageStatus, number>> = {};
  const models = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  for (const decision of decisionsInWindow(decisions, filter)) {
    const status = decision.classifier?.status ?? "NOT_RECORDED";
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (decision.classifier?.provider !== "GEMINI") continue;
    if (decision.classifier.model) models.add(decision.classifier.model);
    const count = (n: number) => (Number.isFinite(n) && n >= 0 ? n : 0);
    inputTokens += count(decision.classifier.inputTokens);
    outputTokens += count(decision.classifier.outputTokens);
    thinkingTokens += count(decision.classifier.thinkingTokens);
  }
  return {
    statuses,
    models: [...models].sort(),
    tokens: { input: inputTokens, output: outputTokens, thinking: thinkingTokens },
  };
}

/**
 * Entrega das respostas da Dara na conversa. Lembretes da agenda ficam de fora
 * de proposito (decisao do titular, 25/09): o painel da Dara mede a Dara.
 *
 * Tres degraus diferentes, que o painel nao pode fundir: `SENT` e o provedor
 * aceitando; `deliveredAt` e o aparelho confirmando; `readAt` so chega quando a
 * pessoa mantem a confirmacao de leitura ligada. Envio `SIMULATED` passou pela
 * fila, mas nao saiu para ninguem.
 */
export function summarizeReplyDeliveries(
  deliveries: readonly NotificationDelivery[],
  filter: AnalyticsFilter,
) {
  const seen = new Set<string>();
  const rows = deliveries.filter((delivery) => {
    const at = Date.parse(delivery.scheduledFor);
    if (
      delivery.organizationId !== filter.organizationId ||
      !isConversationReplyEvent(delivery.event) ||
      seen.has(delivery.id) ||
      !Number.isFinite(at) ||
      at < filter.from.getTime() ||
      at > filter.until.getTime() ||
      (filter.professionalId && delivery.professionalId !== filter.professionalId)
    )
      return false;
    seen.add(delivery.id);
    return true;
  });
  const events: Partial<Record<ConversationReplyEvent, number>> = {};
  const failures: Partial<Record<DeliveryFailureCode, number>> = {};
  for (const row of rows) {
    const event = row.event as ConversationReplyEvent;
    events[event] = (events[event] ?? 0) + 1;
    if (row.status === "FAILED" && row.failureCode)
      failures[row.failureCode] = (failures[row.failureCode] ?? 0) + 1;
  }
  const sent = rows.filter((row) => row.status === "SENT");
  const real = sent.filter((row) => row.providerId !== "SIMULATED");
  return {
    total: rows.length,
    pending: rows.filter((row) => row.status === "PLANNED" || row.status === "SENDING").length,
    sent: sent.length,
    accepted: real.length,
    simulated: sent.length - real.length,
    delivered: real.filter((row) => row.deliveredAt).length,
    read: real.filter((row) => row.readAt).length,
    failed: rows.filter((row) => row.status === "FAILED").length,
    cancelled: rows.filter((row) => row.status === "CANCELLED").length,
    events,
    failures,
  };
}
