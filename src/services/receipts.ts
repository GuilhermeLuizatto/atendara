import { httpsCallable } from "firebase/functions";

import type { ReceiptRequest } from "@/lib/finance/receipts";
import { getFirebaseFunctions } from "@/lib/firebase/client";
import { isDemoMode } from "@/lib/firebase/config";

/**
 * Recibos (C3). Emitir e cancelar passam pelo backend, que reserva a
 * numeracao: na demonstracao nao ha numero de verdade para reservar.
 */
async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  if (isDemoMode) throw new Error("A emissão de recibos existe só com uma conta conectada ao Atendara.");
  try {
    return (await httpsCallable<Input, Output>(getFirebaseFunctions(), name, { timeout: 60_000 })(input)).data;
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/ \[\d{3}\]$/, "") : "";
    throw new Error(message || "Não foi possível concluir a operação.");
  }
}

export const receiptsService = {
  issue: (input: ReceiptRequest & { transactionId: string }) =>
    call<typeof input, { receiptId: string; number: number }>("issueReceipt", input),
  cancel: (receiptId: string, reason: string) => call<{ receiptId: string; reason: string }, { cancelled: true }>("cancelReceipt", { receiptId, reason }),
};
