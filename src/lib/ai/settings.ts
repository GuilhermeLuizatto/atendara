import type { AIAgentSettings } from "@/types";

export function validateAISettings(settings: AIAgentSettings): string[] {
  const errors: string[] = [];
  if (
    typeof settings.enabled !== "boolean" ||
    typeof settings.allowAutonomousReplies !== "boolean"
  ) {
    errors.push("Informe o estado e o modo de resposta da Dara.");
  }
  if (
    typeof settings.displayName !== "string" ||
    !settings.displayName.trim() ||
    settings.displayName.length > 60
  ) {
    errors.push("Informe um nome de até 60 caracteres para a assistente.");
  }
  if (
    !Number.isFinite(settings.autoResponseConfidenceThreshold) ||
    settings.autoResponseConfidenceThreshold < 0.8 ||
    settings.autoResponseConfidenceThreshold > 1
  ) {
    errors.push("A confiança mínima deve estar entre 80% e 100%.");
  }
  const { quietHoursStart: start, quietHoursEnd: end } = settings;
  const time = (value: unknown) =>
    typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (
    !(start === null && end === null) &&
    (!time(start) || !time(end) || start === end)
  ) {
    errors.push(
      "Informe início e fim diferentes para a janela de silêncio, ou deixe ambos vazios.",
    );
  }
  return errors;
}
