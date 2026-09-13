// Gerado por scripts/build-functions.mjs.
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
];
export const AUTOMATION_TASK_STATUSES = [
    "PLANNED",
    "SCHEDULED",
    "DISPATCHING",
    "DISPATCHED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "EXPIRED",
];
/** Motivos de parada que so a fila conhece; os do aviso vem do portao. */
export const AUTOMATION_QUEUE_STOP_REASONS = [
    "TASK_EXPIRED",
    "NO_EXECUTOR",
    "DELIVERY_NOT_FOUND",
];
