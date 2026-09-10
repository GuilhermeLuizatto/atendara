import type { DeliveryFailureCode, DeliveryOutcome, ID, OutboundChannel } from "@/types";

export interface SendRequest {
  deliveryId: ID;
  channel: OutboundChannel;
  /** Destino ja normalizado. O provedor nao normaliza nada. */
  destination: string;
  body: string;
  /** Numero da tentativa, comecando em 1. */
  attempt: number;
}

export interface SendResult {
  outcome: DeliveryOutcome;
  providerMessageId: string | null;
  failureCode: DeliveryFailureCode | null;
}

/**
 * Contrato do provedor de envio.
 *
 * `simulated` e obrigatoriamente `true` no tipo — nao ha implementacao real e o
 * compilador recusa uma. Quando existir um provedor de verdade, este campo vira
 * `boolean` e a mudanca aparece no diff, em vez de um envio real comecar a sair
 * porque alguem trocou uma configuracao.
 */
export interface NotificationProvider {
  readonly id: string;
  readonly simulated: true;
  send(request: SendRequest): Promise<SendResult>;
}
