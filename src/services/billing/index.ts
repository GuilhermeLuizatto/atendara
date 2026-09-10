import { isDemoMode } from "@/lib/firebase/config";
import type {
  PlatformGatewayEvent,
  PlatformInvoice,
  PlatformSubscription,
} from "@/types";

import { FirestorePlatformBillingClient } from "./firestore-billing";
import { BillingUnavailableError, type PlatformBillingClient } from "./types";

export { BillingUnavailableError };
export type { PlatformBillingClient };

/**
 * Modo demonstracao nao tem cobranca — e nao ganha uma simulada.
 *
 * Inventar assinaturas e faturas ficticias aqui criaria exatamente o risco que
 * o projeto evita desde o inicio: um caminho em que a tela mostra dinheiro que
 * nao existe. A demonstracao diz que a area depende de um projeto real e para
 * por ai.
 */
class UnavailablePlatformBillingClient implements PlatformBillingClient {
  readonly available = false;

  async subscription(): Promise<PlatformSubscription | null> {
    return null;
  }
  async invoices(): Promise<PlatformInvoice[]> {
    return [];
  }
  async startCheckout(): Promise<string> {
    throw new BillingUnavailableError();
  }
  async openPortal(): Promise<string> {
    throw new BillingUnavailableError();
  }
  async requestCancellation(): Promise<void> {
    throw new BillingUnavailableError();
  }
  async allSubscriptions(): Promise<PlatformSubscription[]> {
    return [];
  }
  async allInvoices(): Promise<PlatformInvoice[]> {
    return [];
  }
  async recentGatewayEvents(): Promise<PlatformGatewayEvent[]> {
    return [];
  }
}

const client: PlatformBillingClient = isDemoMode
  ? new UnavailablePlatformBillingClient()
  : new FirestorePlatformBillingClient();

/** Ponto unico de escolha, como `createWorkspaceRepository` faz do outro lado. */
export function platformBillingClient(): PlatformBillingClient {
  return client;
}
