import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase/client";
import { isDemoMode } from "@/lib/firebase/config";
import {
  decide,
  type DecisionRequest,
  type DecisionResult,
} from "@/lib/ai/decision-engine";

export async function previewDecision(
  request: DecisionRequest,
  useGemini: boolean,
  message?: { conversationId: string; messageId: string },
): Promise<DecisionResult> {
  if (!useGemini) return decide(request);
  if (isDemoMode)
    throw new Error(
      "O Gemini exige uma conta conectada. Na demonstração, use as regras locais.",
    );
  const input = message
    ? { mode: "MESSAGE", ...message }
    : {
        mode: "SIMULATOR",
        text: request.text,
        channel: request.channel,
        professionalId: request.professionalId,
        at: request.now.toISOString(),
        humanHandoff: request.humanHandoff ?? false,
        client: request.client ?? {
          modality: null,
          status: null,
          hasOutstandingBalance: null,
        },
      };
  try {
    const call = httpsCallable<unknown, { decision: DecisionResult }>(
      getFirebaseFunctions(),
      "previewAI",
      { timeout: 30000 },
    );
    return (await call(input)).data.decision;
  } catch (error) {
    throw new Error(previewFailureMessage(error));
  }
}

/**
 * A mesma frase para tudo escondia a causa: na validação de 26/09 não dava
 * para saber se faltava liberação, se o Gemini demorou ou se a chamada nem
 * saiu. O texto do servidor não é repassado — pode citar detalhe interno.
 */
function previewFailureMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  switch (code) {
    case "functions/permission-denied":
    case "functions/unauthenticated":
      return "Esta conta não pode consultar o Gemini: ele exige conta de profissional, com acesso ativo e o módulo liberado nesta organização.";
    case "functions/deadline-exceeded":
      return "O Gemini demorou mais de 30 segundos para responder. Tente de novo em instantes.";
    case "functions/resource-exhausted":
      return "Muitas consultas seguidas ao Gemini. Espere um minuto e tente de novo.";
    case "functions/not-found":
      return "Esta mensagem não está mais disponível para avaliação.";
    default:
      return "Não foi possível consultar a Dara no servidor. Tente novamente em instantes.";
  }
}
