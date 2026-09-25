import { classificationMeta } from "@/config/classifications";
import {
  DECISION_REVIEW_VERDICTS,
  err,
  ok,
  type AIDecision,
  type AIDecisionReview,
  type DecisionReviewVerdict,
  type ID,
  type ISODateString,
  type MessageClassificationId,
  type Result,
} from "@/types";

export interface DecisionReviewInput {
  verdict: DecisionReviewVerdict;
  expectedClassification: MessageClassificationId | null;
}

/**
 * Mesma validacao para o Firestore e para a demonstracao — e a mesma que as
 * rules repetem em `decisionReviewOk()`. A lista de classificacoes e a da
 * profissao: "era clinica" nao faz sentido onde a profissao nao classifica
 * assim.
 */
export function validateDecisionReview(
  decision: AIDecision,
  input: DecisionReviewInput,
  classifications: readonly MessageClassificationId[],
): Result<DecisionReviewInput> {
  if (!DECISION_REVIEW_VERDICTS.includes(input.verdict))
    return err("Escolha se a classificação estava correta.");
  if (input.verdict === "CORRECT") return ok({ verdict: "CORRECT", expectedClassification: null });
  const expected = input.expectedClassification;
  if (!expected) return err("Informe qual classificação deveria ter saído.");
  if (!classifications.includes(expected))
    return err("Essa classificação não existe nesta profissão.");
  if (expected === decision.classification)
    return err("A classificação informada é a mesma da decisão. Marque como correta.");
  return ok({ verdict: "INCORRECT", expectedClassification: expected });
}

/** Corrigir uma revisao preserva quem revisou primeiro e quando. */
export function buildDecisionReview(
  decision: AIDecision,
  input: DecisionReviewInput,
  existing: AIDecisionReview | null,
  meta: { now: ISODateString; userId: ID | null },
): AIDecisionReview {
  return {
    id: decision.id,
    organizationId: decision.organizationId,
    decisionId: decision.id,
    verdict: input.verdict,
    expectedClassification: input.expectedClassification,
    createdAt: existing?.createdAt ?? meta.now,
    createdBy: existing?.createdBy ?? meta.userId,
    updatedAt: meta.now,
    updatedBy: meta.userId,
  };
}

/** Texto da trilha, igual no Firestore e na demonstracao. */
export function decisionReviewAuditSummary(review: DecisionReviewInput): string {
  return review.verdict === "CORRECT" || !review.expectedClassification
    ? "Classificação da Dara marcada como correta."
    : `Classificação da Dara marcada como errada: era ${classificationMeta(review.expectedClassification).label}.`;
}
