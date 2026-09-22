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
  } catch {
    throw new Error(
      "Não foi possível consultar a Dara no servidor. Verifique seu acesso e tente novamente.",
    );
  }
}
