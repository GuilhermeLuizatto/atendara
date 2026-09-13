import type {
  AppointmentNotificationEvent,
  AutomationExecutor,
  AutomationQueueStopReason,
  AutomationTaskStatus,
  AutomationTaskType,
} from "@/types";

/**
 * Politica da fila de automacao, como DADO (Fase 3, 13.2).
 *
 * O que cada tipo de tarefa e, quem o executa, quais mudancas de estado existem
 * e quanto tempo cada coisa pode esperar. `lib/automation` executa; este arquivo
 * decide. As functions recebem a mesma politica por `scripts/build-functions.mjs`.
 */

export interface AutomationTaskMeta {
  label: string;
  /**
   * `INTERNAL` roda dentro das functions e nunca sai do Atendara — nem para a
   * Cloud Tasks, nem para o n8n. Alerta e trilha gravados por um executor de
   * fora seriam prova que uma credencial vazada consegue forjar.
   */
  executor: AutomationExecutor;
}

export const AUTOMATION_TASK_META: Record<AutomationTaskType, AutomationTaskMeta> = {
  CONFIRM_APPOINTMENT: { label: "Aviso de confirmação", executor: "EXTERNAL" },
  SEND_REMINDER: { label: "Lembrete", executor: "EXTERNAL" },
  PROCESS_INBOUND_MESSAGE: { label: "Mensagem recebida", executor: "INTERNAL" },
  RAISE_ALERT: { label: "Alerta para a equipe", executor: "INTERNAL" },
  WRITE_AUDIT: { label: "Registro na trilha", executor: "INTERNAL" },
};

/**
 * Evento da agenda -> tarefa que o executa.
 *
 * `null` quer dizer que o servidor ainda nao executa aquele evento, e por isso
 * ele nao planeja envio nenhum (`EVENT_WITHOUT_AUTOMATION`). Agendamento e
 * cancelamento ganham tipo proprio numa etapa seguinte; ate la, uma regra ligada
 * para eles fica gravada e nao manda nada.
 */
export const NOTICE_TASK_TYPES: Record<AppointmentNotificationEvent, AutomationTaskType | null> = {
  APPOINTMENT_SCHEDULED: null,
  APPOINTMENT_REMINDER: "SEND_REMINDER",
  APPOINTMENT_CONFIRMED: "CONFIRM_APPOINTMENT",
  APPOINTMENT_CANCELLED: null,
};

export interface AutomationTransitionRule {
  from: AutomationTaskStatus;
  to: AutomationTaskStatus;
  executors: readonly AutomationExecutor[];
}

const ANY: readonly AutomationExecutor[] = ["INTERNAL", "EXTERNAL"];
const EXTERNAL: readonly AutomationExecutor[] = ["EXTERNAL"];
const INTERNAL: readonly AutomationExecutor[] = ["INTERNAL"];

/**
 * Mudancas de estado validas. O que nao esta aqui e recusado.
 *
 * - Externa: planejada, agendada na Cloud Tasks, adquirida pelo despachante (que
 *   confere as travas na mesma transacao), entregue ao executor e concluida.
 * - Interna: planejada, adquirida e concluida no mesmo ato, sem fila.
 * - Falha retentavel volta a `SCHEDULED` com a tentativa seguinte. `SUCCEEDED`,
 *   `FAILED`, `CANCELLED` e `EXPIRED` sao terminais: nada sai deles.
 */
export const AUTOMATION_TRANSITIONS: readonly AutomationTransitionRule[] = [
  { from: "PLANNED", to: "SCHEDULED", executors: EXTERNAL },
  { from: "SCHEDULED", to: "DISPATCHING", executors: EXTERNAL },
  { from: "DISPATCHING", to: "DISPATCHED", executors: EXTERNAL },
  { from: "DISPATCHED", to: "SUCCEEDED", executors: EXTERNAL },
  { from: "DISPATCHED", to: "FAILED", executors: EXTERNAL },
  { from: "DISPATCHED", to: "SCHEDULED", executors: EXTERNAL },
  { from: "PLANNED", to: "DISPATCHING", executors: INTERNAL },
  { from: "DISPATCHING", to: "SUCCEEDED", executors: INTERNAL },
  { from: "DISPATCHING", to: "FAILED", executors: ANY },
  { from: "PLANNED", to: "CANCELLED", executors: ANY },
  { from: "SCHEDULED", to: "CANCELLED", executors: EXTERNAL },
  { from: "PLANNED", to: "EXPIRED", executors: ANY },
  { from: "SCHEDULED", to: "EXPIRED", executors: EXTERNAL },
];

export const TERMINAL_AUTOMATION_STATUSES: readonly AutomationTaskStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
];

/** Nada saiu ainda: a agenda pode cancelar. Depois de adquirida, so o despachante decide. */
export const WAITING_AUTOMATION_STATUSES: readonly AutomationTaskStatus[] = ["PLANNED", "SCHEDULED"];

/** Versao do ponteiro que a Cloud Tasks entrega. Mudanca incompativel aumenta o numero. */
export const AUTOMATION_CONTRACT_VERSION = 1;

export const DISPATCHER_TIMEOUT_SECONDS = 60;

/**
 * Quanto tempo uma tarefa em `DISPATCHING` e tida como em execucao. Passado isso
 * sem resultado, a execucao morreu no meio: vira `FAILED` com
 * `DISPATCH_INTERRUPTED` e alerta, sem nova tentativa — nao da para saber se o
 * envio saiu, e repetir poderia mandar a mesma mensagem duas vezes.
 */
export const DISPATCH_LEASE_SECONDS = 180;

/** A Cloud Tasks nao agenda mais de 30 dias a frente; a margem evita a borda. */
export const QUEUE_MAX_DELAY_DAYS = 29;

/** Tolerancia de relogio entre a Cloud Tasks e o despachante. */
export const DISPATCH_CLOCK_SKEW_SECONDS = 5;

/**
 * Evento da agenda entregue depois disso nao planeja mais nada. O gatilho e
 * repetido em caso de erro; sem limite, um erro permanente repetiria por dias.
 */
export const PLANNING_EVENT_MAX_AGE_MINUTES = 1_440;

/**
 * Tentativas da Cloud Tasks de ENTREGAR o ponteiro ao despachante. Nao sao
 * tentativas de envio: essas seguem `RETRY_POLICY` e ficam na tarefa.
 */
export const DISPATCHER_QUEUE_RETRY = {
  maxAttempts: 5,
  minBackoffSeconds: 30,
  maxBackoffSeconds: 600,
} as const;

/** Tarefa interna nasce e termina no mesmo ato; a validade so completa o formato. */
export const INTERNAL_TASK_VALIDITY_MINUTES = 60;

/** Autor das entradas que a automacao grava na trilha e nos alertas. */
export const AUTOMATION_ACTOR_NAME = "Automação do Atendara";

export const AUTOMATION_QUEUE_STOP_LABELS: Record<AutomationQueueStopReason, string> = {
  TASK_EXPIRED: "A tarefa venceu antes de ser executada.",
  NO_EXECUTOR: "Não há executor para este tipo de tarefa.",
  DELIVERY_NOT_FOUND: "O registro do aviso não foi encontrado.",
};

export const AUTOMATION_ALERT_TITLE = "Aviso não enviado";
