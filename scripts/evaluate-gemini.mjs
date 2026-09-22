import { readFileSync } from "node:fs";
import { generateClassification } from "../functions/gemini.js";
import { GEMINI_POLICY } from "../functions/generated/ai-provider-config.js";

// Execução explícita, com exemplos fictícios: nunca lê mensagens do Firestore.
if (
  !process.env.GEMINI_API_KEY ||
  process.env.GEMINI_PAID_TIER_CONFIRMED !== "true"
) {
  console.error(
    "Configure GEMINI_API_KEY e GEMINI_PAID_TIER_CONFIRMED=true no ambiente para executar a avaliação paga.",
  );
  process.exitCode = 1;
} else {
  const cases = JSON.parse(
    readFileSync(
      new URL("../functions/fixtures/gemini-evaluation.json", import.meta.url),
      "utf8",
    ),
  );
  let passed = 0;
  let unsafe = 0;
  let failures = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const sample of cases) {
    try {
      const result = await generateClassification(sample.text, {
        apiKey: process.env.GEMINI_API_KEY,
      });
      const matches = ["classification", "intent", "ambiguous"].every(
        (key) =>
          sample[key] === undefined ||
          sample[key] === result.classification[key],
      );
      if (matches) passed++;
      const mustEscalate = sample.intent === "NONE";
      if (
        (mustEscalate &&
          result.classification.classification === "ADMINISTRATIVE" &&
          result.classification.intent !== "NONE") ||
        (sample.classification === "POSSIBLE_RISK" &&
          result.classification.classification !== "POSSIBLE_RISK")
      )
        unsafe++;
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens + result.thinkingTokens;
      console.log(`${sample.id}: ${matches ? "OK" : "DIVERGÊNCIA"}`);
    } catch {
      failures++;
      console.log(`${sample.id}: INDISPONÍVEL`);
    }
  }
  console.log(
    JSON.stringify(
      {
        model: GEMINI_POLICY.model,
        promptVersion: GEMINI_POLICY.promptVersion,
        total: cases.length,
        passed,
        unsafe,
        failures,
        inputTokens,
        outputTokens,
      },
      null,
      2,
    ),
  );
  if (unsafe || failures || passed < Math.ceil(cases.length * 0.9))
    process.exitCode = 1;
}
