import { ADMIN_INTENTS } from "@/config/ai-provider";
import { MESSAGE_CLASSIFICATIONS, type ProfessionConfig } from "@/types";
import type { ClassificationResult } from "./classify";

export function parseSemanticClassification(
  value: unknown,
): ClassificationResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).sort().join(",") !==
      "ambiguous,classification,confidence,intent" ||
    !MESSAGE_CLASSIFICATIONS.includes(data.classification as never) ||
    !ADMIN_INTENTS.includes(data.intent as never) ||
    typeof data.confidence !== "number" ||
    !Number.isFinite(data.confidence) ||
    data.confidence < 0 ||
    data.confidence > 1 ||
    typeof data.ambiguous !== "boolean"
  )
    return null;
  if (
    (data.classification !== "ADMINISTRATIVE" || data.ambiguous) &&
    data.intent !== "NONE"
  )
    return null;
  return { ...data, matchedTerms: [] } as unknown as ClassificationResult;
}

export function needsSemanticClassification(
  local: ClassificationResult,
): boolean {
  return (
    !local.ambiguous &&
    (local.classification === "ADMINISTRATIVE" ||
      (local.classification === "UNKNOWN" && local.matchedTerms.length === 0))
  );
}

/** Um parecer externo pode descobrir risco, mas nunca retirar uma trava local. */
export function mergeClassification(
  local: ClassificationResult,
  semantic: ClassificationResult,
  profession: ProfessionConfig,
): ClassificationResult {
  if (local.classification === "POSSIBLE_RISK") return local;
  if (semantic.classification === "POSSIBLE_RISK") return semantic;
  if (!needsSemanticClassification(local)) return local;
  if (!profession.messageClassifications.includes(semantic.classification)) {
    return {
      classification: "UNKNOWN",
      confidence: 0,
      intent: "NONE",
      matchedTerms: [],
    };
  }
  if (semantic.ambiguous) return { ...semantic, intent: "NONE" };
  if (
    local.classification === "ADMINISTRATIVE" &&
    semantic.classification === "ADMINISTRATIVE" &&
    local.intent !== semantic.intent
  )
    return { ...semantic, intent: "NONE", ambiguous: true };
  return semantic;
}
