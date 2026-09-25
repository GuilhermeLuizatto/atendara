import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref } from "firebase/storage";

import type { PublicPaymentView } from "@/lib/finance/payment-proof";
import { getFirebaseFunctions, getFirebaseStorage } from "@/lib/firebase/client";
import { isDemoMode } from "@/lib/firebase/config";

/**
 * Link de pagamento e comprovante (cobrador, C2). Tudo passa pelo backend: na
 * demonstracao nao ha link real para mandar a ninguem.
 */

async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  if (isDemoMode) throw new Error("O link de pagamento existe só com uma conta conectada ao Atendara.");
  try {
    return (await httpsCallable<Input, Output>(getFirebaseFunctions(), name, { timeout: 120_000 })(input)).data;
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/ \[\d{3}\]$/, "") : "";
    throw new Error(message || "Não foi possível concluir a operação.");
  }
}

export const paymentLinks = {
  create: (transactionId: string) => call<{ transactionId: string }, { token: string }>("createPaymentLink", { transactionId }),
  inspect: (token: string) => call<{ token: string }, PublicPaymentView>("inspectPaymentLink", { token }),
  submitProof: (token: string, file: string) => call<{ token: string; file: string }, { received: true }>("submitPaymentProof", { token, file }),
  proofUrl: (storagePath: string) => getDownloadURL(ref(getFirebaseStorage(), storagePath)),
};

/** Arquivo em base64 puro, sem o prefixo `data:`. O tipo quem decide e o backend. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}
