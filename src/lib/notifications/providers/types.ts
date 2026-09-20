import type { DeliveryFailureCode, DeliveryOutcome, ID, ISODateString, OutboundChannel } from "@/types";

export interface SendRequest {
  deliveryId: ID;
  channel: OutboundChannel;
  /** Destino ja normalizado. O provedor nao normaliza nada. */
  destination: string;
  body: string;
  /** Numero da tentativa, comecando em 1. */
  attempt: number;
  /**
   * Identidade da tarefa que originou o envio (Fase 3, 13.3). O provedor
   * simulado ignora; a ponte com o n8n precisa deles para que o resultado volte
   * pela rota assinada e caia na tarefa certa, sem que o n8n consulte o banco.
   */
  taskId: ID;
  organizationId: ID;
  /** Estavel entre tentativas: e por ela que o executor recusa repeticao. */
  idempotencyKey: string;
  /** Depois disto o envio nao vale mais, e quem o receber deve recusar. */
  expiresAt: ISODateString;
}

export interface SendResult {
  outcome: DeliveryOutcome;
  providerMessageId: string | null;
  failureCode: DeliveryFailureCode | null;
}

/**
 * Contrato do provedor de envio.
 *
 * **Mudou na 13.3, e a mudanca e deliberada:** ate a 13.2 `simulated` era
 * obrigatoriamente `true` no tipo, e o compilador recusava qualquer outro
 * provedor. A ponte com o n8n (`N8N_BRIDGE`) e o primeiro provedor que abre
 * conexao, entao o campo virou `boolean`. A trava nao sumiu, mudou de lugar:
 * quem decide se um canal usa provedor real e `CHANNEL_META[canal].providerId`,
 * e hoje **os tres canais continuam em `SIMULATED`**. Ligar um canal real e uma
 * linha de configuracao que aparece no diff, e ainda depende de segredo
 * configurado no Secret Manager.
 *
 * `handoff` separa dois contratos diferentes dentro do mesmo `send`:
 *
 * - `false` (simulado): o resultado devolvido E o resultado do envio.
 * - `true` (ponte): `ACCEPTED` quer dizer apenas "o executor recebeu a tarefa".
 *   A tarefa fica em `DISPATCHED` e o resultado chega depois, pela rota
 *   assinada `automationCallback`. Sem essa distincao, entregar a tarefa ao n8n
 *   marcaria o aviso como enviado antes de o WhatsApp existir.
 */
export interface NotificationProvider {
  readonly id: string;
  readonly simulated: boolean;
  readonly handoff: boolean;
  send(request: SendRequest): Promise<SendResult>;
}
