/** Limites conservadores para a primeira integração semântica. */
export const GEMINI_POLICY = {
  model: "gemini-3.1-flash-lite",
  promptVersion: "classification-1",
  maxInputCharacters: 4000,
  maxOutputTokens: 512,
  timeoutMs: 12000,
} as const;

export const ADMIN_INTENTS = [
  "PRICING",
  "SCHEDULING",
  "RESCHEDULING",
  "CONFIRMATION",
  "CANCELLATION",
  "LOCATION",
  "PAYMENT",
  "SERVICES",
  "NONE",
] as const;
