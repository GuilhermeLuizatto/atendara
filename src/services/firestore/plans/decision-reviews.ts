import { classificationsFor } from "@/config/professions";
import {
  buildDecisionReview,
  decisionReviewAuditSummary,
  validateDecisionReview,
  type DecisionReviewInput,
} from "@/lib/ai/decision-review";
import type { ID } from "@/types";

import { assertPermission } from "../../guards";
import { RepositoryError } from "../../types";
import { auditWrite, docPath, type Plan, type PlanContext } from "../plan";

/**
 * Revisao da classificacao de uma decisao da Dara (Fase 4).
 *
 * A decisao nao e tocada: `aiDecisions` e append-only. A revisao vive ao lado,
 * com o mesmo id, e cada mudanca de veredito deixa uma entrada na trilha — e
 * a trilha que responde "quem disse que estava errado, e quando".
 */
export function planReviewDecision(
  ctx: PlanContext,
  decisionId: ID,
  raw: DecisionReviewInput,
): Plan {
  assertPermission(ctx.actor, "aiDecision:review");
  const decision = ctx.snapshot.decisions.find((item) => item.id === decisionId);
  if (!decision) throw new RepositoryError("Decisão não encontrada.");
  const validation = validateDecisionReview(
    decision,
    raw,
    classificationsFor(ctx.snapshot.organization.primaryProfession),
  );
  if (!validation.ok) throw new RepositoryError(validation.error);

  const existing =
    ctx.snapshot.decisionReviews?.find((item) => item.decisionId === decisionId) ?? null;
  const review = buildDecisionReview(decision, validation.value, existing, {
    now: ctx.now,
    userId: ctx.actor.userId,
  });

  return {
    result: undefined,
    writes: [
      {
        op: "set",
        collection: "aiDecisionReviews",
        path: docPath(ctx, "aiDecisionReviews", decisionId),
        data: review as unknown as Record<string, unknown>,
      },
      auditWrite(ctx, {
        action: existing ? "UPDATE" : "CREATE",
        actorType: "USER",
        resource: { type: "aiDecisionReview", id: decisionId },
        summary: decisionReviewAuditSummary(review),
        metadata: {
          verdict: review.verdict,
          classification: decision.classification,
          expectedClassification: review.expectedClassification,
          previousVerdict: existing?.verdict ?? null,
        },
      }),
    ],
  };
}
