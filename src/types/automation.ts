import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type {
  AppointmentNotificationEvent,
  DeliveryFailureCode,
  NotificationDispatchStopReason,
  OutboundChannel,
} from "./notifications";
import type { PrivacyRedactionMark } from "./privacy";

/**
 * Fila de automacao da organizacao (Fase 3, 13.2).
 *
 * Uma tarefa e de UMA organizacao, de UM tipo e tem UMA tentativa corrente. O
 * navegador nao le nem escreve a fila: o gatilho da agenda planeja, a Cloud
 * Tasks agenda o horario e o despachante executa — tudo no backend, que confere
 * de novo as travas de `eligibility.ts` imediatamente antes de cada envio.
 */
export const AUTOMATION_TASK_TYPES = [
  "CONFIRM_APPOINTMENT",
  "SEND_REMINDER",
  "PROCESS_INBOUND_MESSAGE",
  "RAISE_ALERT",
  "WRITE_AUDIT",
] as const;

export type AutomationTaskType = (typeof AUTOMATION_TASK_TYPES)[number];

/** `INTERNAL` roda dentro das functions e nunca sai do Atendara. */
export type AutomationExecutor = "INTERNAL" | "EXTERNAL";

export const AUTOMATION_TASK_STATUSES = [
  "PLANNED",
  "SCHEDULED",
  "DISPATCHING",
  "DISPATCHED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type AutomationTaskStatus = (typeof AUTOMATION_TASK_STATUSES)[number];

/** Motivos de parada que so a fila conhece; os do aviso vem do portao. */
export const AUTOMATION_QUEUE_STOP_REASONS = [
  "TASK_EXPIRED",
  "NO_EXECUTOR",
  "DELIVERY_NOT_FOUND",
] as const;

export type AutomationQueueStopReason = (typeof AUTOMATION_QUEUE_STOP_REASONS)[number];

export type AutomationStopReason = NotificationDispatchStopReason | AutomationQueueStopReason;

/**
 * Um passo do estado da tarefa. `code` e motivo nomeado ou codigo de falha —
 * nunca a mensagem do provedor, que costuma repetir o destino.
 */
export interface AutomationTransition {
  from: AutomationTaskStatus | null;
  to: AutomationTaskStatus;
  at: ISODateString;
  attempt: number;
  code: string | null;
}

/**
 * O registro da execucao.
 *
 * Como `NotificationDelivery`, nao guarda texto, contato nem nome: o destino e o
 * corpo sao recompostos do estado atual no instante do envio e existem so na
 * memoria do despachante. `expiresAt` e a validade da EXECUCAO — passado dele a
 * tarefa nao executa —, e nao prazo de retencao: nenhuma politica de TTL pode
 * ser ligada nesse campo.
 */
export interface AutomationTask extends TenantScopedEntity {
  type: AutomationTaskType;
  status: AutomationTaskStatus;
  /** Tentativa corrente, a partir de 1. Nova tentativa e nova emissao. */
  attempt: number;
  maxAttempts: number;
  /** Quando a tentativa corrente deve executar. */
  scheduledFor: ISODateString;
  expiresAt: ISODateString;
  /** Estavel entre tentativas. Para aviso, e o `deliveryKey`. */
  idempotencyKey: string;
  appointmentId: ID | null;
  /** Inicio do atendimento quando a tarefa foi planejada. Remarcar cancela. */
  appointmentStartsAt: ISODateString | null;
  clientId: ID | null;
  professionalId: ID | null;
  /** Aviso: o registro em `notificationDeliveries`, com o mesmo id. */
  deliveryId: ID | null;
  /** Alerta e trilha: a tarefa cuja mudanca de estado os originou. */
  sourceTaskId: ID | null;
  event: AppointmentNotificationEvent | null;
  channel: OutboundChannel | null;
  failureCode: DeliveryFailureCode | null;
  stopReason: AutomationStopReason | null;
  providerMessageId: string | null;
  /** Inicio da execucao em andamento. `null` fora de `DISPATCHING`. */
  dispatchingSince: ISODateString | null;
  completedAt: ISODateString | null;
  history: AutomationTransition[];
  privacyRedaction?: PrivacyRedactionMark | null;
}

/**
 * O que a Cloud Tasks entrega ao despachante. So ponteiro: o despachante le a
 * tarefa e o estado atual do banco, e nada do corpo e aceito como verdade.
 */
export interface AutomationDispatchPayload {
  version: 1;
  organizationId: ID;
  taskId: ID;
  attempt: number;
}
