// Gerado por scripts/build-functions.mjs.
import { ADMIN_INTENTS } from "./ai-provider-config.js";
import { MESSAGE_CLASSIFICATIONS } from "./types.js";
export function parseSemanticClassification(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const data = value;
    if (Object.keys(data).sort().join(",") !==
        "ambiguous,classification,confidence,intent" ||
        !MESSAGE_CLASSIFICATIONS.includes(data.classification) ||
        !ADMIN_INTENTS.includes(data.intent) ||
        typeof data.confidence !== "number" ||
        !Number.isFinite(data.confidence) ||
        data.confidence < 0 ||
        data.confidence > 1 ||
        typeof data.ambiguous !== "boolean")
        return null;
    if ((data.classification !== "ADMINISTRATIVE" || data.ambiguous) &&
        data.intent !== "NONE")
        return null;
    return { ...data, matchedTerms: [] };
}
export function needsSemanticClassification(local) {
    return (!local.ambiguous &&
        (local.classification === "ADMINISTRATIVE" ||
            (local.classification === "UNKNOWN" && local.matchedTerms.length === 0)));
}
/** Um parecer externo pode descobrir risco, mas nunca retirar uma trava local. */
export function mergeClassification(local, semantic, profession) {
    if (local.classification === "POSSIBLE_RISK")
        return local;
    if (semantic.classification === "POSSIBLE_RISK")
        return semantic;
    if (!needsSemanticClassification(local))
        return local;
    if (!profession.messageClassifications.includes(semantic.classification)) {
        return {
            classification: "UNKNOWN",
            confidence: 0,
            intent: "NONE",
            matchedTerms: [],
        };
    }
    if (semantic.ambiguous)
        return { ...semantic, intent: "NONE" };
    if (local.classification === "ADMINISTRATIVE" &&
        semantic.classification === "ADMINISTRATIVE" &&
        local.intent !== semantic.intent)
        return { ...semantic, intent: "NONE", ambiguous: true };
    return semantic;
}
