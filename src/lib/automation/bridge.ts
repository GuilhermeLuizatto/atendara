import { AUTOMATION_CONTRACT_VERSION } from "@/config/automation";
import type { SendRequest } from "@/lib/notifications/providers/types";
import type {
  AutomationTask,
  DeliveryFailureCode,
  DeliveryOutcome,
  ID,
  ISODateString,
  NotificationDelivery,
} from "@/types";
import { DELIVERY_FAILURE_CODES } from "@/types";

import { isTaskExpired, isTerminalStatus } from "./tasks";

/**
 * O contrato entre o Atendara e o n8n (Fase 3, 13.3), sem I/O.
 *
 * Duas metades, as duas assinadas com HMAC-SHA256 e segredos DIFERENTES:
 *
 * - **ida** (`bridgeTaskPayload`): a tarefa que o n8n vai executar, com o
 *   minimo da secao 3 do plano. Segredo A.
 * - **volta** (`decideCallback`): o resultado que o n8n relata. Segredo B.
 *
 * Nada do que volta e aceito como verdade alem do resultado do envio: a
 * organizacao, a tentativa, o estado e o prazo sao conferidos contra a tarefa
 * lida do banco na mesma transacao. Um n8n comprometido consegue mentir sobre o
 * que o WhatsApp respondeu — e isso esta assumido na secao 10 do ADR 0003 —,
 * mas nao consegue mexer em tarefa de outra organizacao, ressuscitar tarefa
 * terminada, pular tentativa nem escrever na trilha.
 */

export const BRIDGE_CONTRACT_VERSION = AUTOMATION_CONTRACT_VERSION;

export const BRIDGE_TIMESTAMP_HEADER = "x-atendara-timestamp";
export const BRIDGE_SIGNATURE_HEADER = "x-atendara-signature";

/** Janela de validade da assinatura, nos dois sentidos (secao 3 do plano). */
export const BRIDGE_SIGNATURE_WINDOW_SECONDS = 300;

/**
 * A tarefa que sai. **Nao leva** texto livre, dado clinico, nome, credencial
 * nem id de cadastro: so o que o executor precisa para falar com o canal.
 *
 * `body` e o texto do modelo ja montado pelo Atendara — nao e texto livre de
 * ninguem, e some daqui na 13.4, quando o WhatsApp passar a receber nome e
 * parametros do modelo aprovado pela Meta em vez do texto pronto.
 */
export interface BridgeTaskPayload {
  version: number;
  taskId: ID;
  organizationId: ID;
  attempt: number;
  idempotencyKey: string;
  expiresAt: ISODateString;
  channel: SendRequest["channel"];
  deliveryId: ID;
  destination: string;
  body: string;
}

export function bridgeTaskPayload(request: SendRequest): BridgeTaskPayload {
  return {
    version: BRIDGE_CONTRACT_VERSION,
    taskId: request.taskId,
    organizationId: request.organizationId,
    attempt: request.attempt,
    idempotencyKey: request.idempotencyKey,
    expiresAt: request.expiresAt,
    channel: request.channel,
    deliveryId: request.deliveryId,
    destination: request.destination,
    body: request.body,
  };
}

/**
 * A assinatura cobre horario **e** corpo. So o corpo deixaria um pedido antigo
 * valer para sempre; so o horario deixaria trocar o conteudo.
 */
export function signedMessage(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

/** Fora da janela, a assinatura nao vale — mesmo correta. */
export function isWithinSignatureWindow(timestamp: string, now: ISODateString): boolean {
  const sent = Date.parse(timestamp);
  if (Number.isNaN(sent)) return false;
  return Math.abs(Date.parse(now) - sent) <= BRIDGE_SIGNATURE_WINDOW_SECONDS * 1000;
}

// ------------------------------------------------------------------ volta

export interface BridgeCallbackPayload {
  version: number;
  taskId: ID;
  organizationId: ID;
  attempt: number;
  outcome: DeliveryOutcome;
  providerMessageId: string | null;
  failureCode: DeliveryFailureCode | null;
}

const OUTCOMES: readonly DeliveryOutcome[] = ["ACCEPTED", "TEMPORARY_FAILURE", "REJECTED"];

/**
 * Forma do retorno. Valida so o formato; quem confere se ele **pode** ser
 * aplicado e `decideCallback`, contra a tarefa do banco.
 */
export function parseCallbackPayload(data: unknown): BridgeCallbackPayload | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  const text = (value: unknown, max: number): string | null =>
    typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

  const taskId = text(raw.taskId, 700);
  const organizationId = text(raw.organizationId, 128);
  const outcome = OUTCOMES.find((value) => value === raw.outcome) ?? null;
  const attempt = typeof raw.attempt === "number" && Number.isInteger(raw.attempt) && raw.attempt >= 1 && raw.attempt <= 10 ? raw.attempt : null;
  if (raw.version !== BRIDGE_CONTRACT_VERSION || !taskId || !organizationId || !outcome || attempt === null) return null;

  const providerMessageId = raw.providerMessageId == null ? null : text(raw.providerMessageId, 200);
  if (raw.providerMessageId != null && providerMessageId === null) return null;

  // Codigo de falha vem da NOSSA lista. Texto do provedor nunca entra: ele
  // costuma repetir o destino, que e contato de paciente.
  const failureCode =
    raw.failureCode == null
      ? null
      : (DELIVERY_FAILURE_CODES.find((code) => code === raw.failureCode) ?? null);
  if (raw.failureCode != null && failureCode === null) return null;
  if (outcome === "ACCEPTED" && failureCode !== null) return null;
  if (outcome !== "ACCEPTED" && failureCode === null) return null;

  return { version: BRIDGE_CONTRACT_VERSION, taskId, organizationId, attempt, outcome, providerMessageId, failureCode };
}

export type CallbackDecision =
  /** Aplicar o resultado a esta tarefa. */
  | { kind: "APPLY"; task: AutomationTask; delivery: NotificationDelivery }
  /**
   * Nada a fazer, e isso NAO e erro: retorno repetido da mesma tentativa, que a
   * fila do n8n reentrega. Responder 200 evita que ele fique repetindo.
   */
  | { kind: "IGNORE"; why: "ALREADY_APPLIED" | "STALE_ATTEMPT" }
  /** Recusar, com registro: o retorno nao pode valer para esta tarefa. */
  | { kind: "REJECT"; why: "NOT_FOUND" | "WRONG_ORGANIZATION" | "NOT_AWAITING" | "TASK_EXPIRED" | "DELIVERY_NOT_FOUND" };

export function decideCallback(input: {
  payload: BridgeCallbackPayload;
  /** Organizacao lida do proprio caminho do documento, nao do corpo. */
  task: AutomationTask | null;
  delivery: NotificationDelivery | null;
  now: ISODateString;
}): CallbackDecision {
  const { payload, task, delivery, now } = input;

  if (!task || task.id !== payload.taskId) return { kind: "REJECT", why: "NOT_FOUND" };
  if (task.organizationId !== payload.organizationId) return { kind: "REJECT", why: "WRONG_ORGANIZATION" };

  // Terminal com a mesma tentativa e a reentrega do mesmo retorno; com
  // tentativa diferente, e retorno de uma tentativa que ja foi superada.
  if (isTerminalStatus(task.status)) {
    return { kind: "IGNORE", why: task.attempt === payload.attempt ? "ALREADY_APPLIED" : "STALE_ATTEMPT" };
  }
  if (payload.attempt !== task.attempt) return { kind: "IGNORE", why: "STALE_ATTEMPT" };

  // So tarefa entregue ao executor aceita resultado. `SCHEDULED` ou
  // `DISPATCHING` significam que o retorno chegou por um caminho que nao
  // existe — e um retorno forjado tentaria exatamente isso.
  if (task.status !== "DISPATCHED") return { kind: "REJECT", why: "NOT_AWAITING" };

  if (isTaskExpired(task, now)) return { kind: "REJECT", why: "TASK_EXPIRED" };
  if (!delivery || delivery.id !== task.deliveryId) return { kind: "REJECT", why: "DELIVERY_NOT_FOUND" };

  return { kind: "APPLY", task, delivery };
}
