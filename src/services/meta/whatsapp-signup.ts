import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "@/lib/firebase/client";
import { isDemoMode } from "@/lib/firebase/config";
import { AuthError } from "@/lib/auth/types";

export interface CompleteWhatsappEmbeddedSignupInput {
  code: string;
  businessId: string | null;
  wabaId: string;
  phoneNumberId: string;
}

export interface CompleteWhatsappEmbeddedSignupOutput {
  status: "VALIDATED";
  displayNumber: string;
  displayName: string;
  wabaId: string;
  phoneNumberId: string;
}

/** O código é entregue uma única vez à callable e não é persistido no cliente. */
export async function completeWhatsappEmbeddedSignup(
  input: CompleteWhatsappEmbeddedSignupInput,
): Promise<CompleteWhatsappEmbeddedSignupOutput> {
  if (isDemoMode) {
    throw new AuthError("A demonstração local não conecta uma conta real da Meta.");
  }

  const callable = httpsCallable<CompleteWhatsappEmbeddedSignupInput, CompleteWhatsappEmbeddedSignupOutput>(
    getFirebaseFunctions(),
    "completeWhatsappEmbeddedSignup",
  );
  return (await callable(input)).data;
}
