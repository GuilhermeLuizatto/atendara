// Gerado por scripts/build-functions.mjs.
import { AUTOMATION_ACTOR_NAME, AUTOMATION_QUEUE_STOP_LABELS, AUTOMATION_TASK_META, } from "./automation-config.js";
import { CHANNEL_META, DELIVERY_FAILURE_LABELS, NOTIFICATION_DISPATCH_STOP_LABELS, SKIP_REASON_LABELS, } from "./notifications-config.js";
import { formatDateTime } from "./format.js";
import { AUTOMATION_QUEUE_STOP_REASONS, NOTIFICATION_DISPATCH_ONLY_STOP_REASONS, } from "./types.js";
import { newInternalTask, transitionTask } from "./automation-tasks.js";
export function stopReasonLabel(reason) {
    if (AUTOMATION_QUEUE_STOP_REASONS.includes(reason)) {
        return AUTOMATION_QUEUE_STOP_LABELS[reason];
    }
    if (NOTIFICATION_DISPATCH_ONLY_STOP_REASONS.includes(reason)) {
        return NOTIFICATION_DISPATCH_STOP_LABELS[reason];
    }
    return SKIP_REASON_LABELS[reason];
}
function subject(task) {
    const label = AUTOMATION_TASK_META[task.type].label;
    return task.channel ? `${label} por ${CHANNEL_META[task.channel].label}` : label;
}
function failureLabel(task) {
    const label = task.failureCode ? DELIVERY_FAILURE_LABELS[task.failureCode] : "falha sem código";
    return label.charAt(0).toLowerCase() + label.slice(1);
}
/**
 * A agenda Google nao "envia" nada a ninguem: o texto fala de atualizar a
 * agenda, para a trilha nao sugerir que uma mensagem saiu.
 */
function calendarSummary(task) {
    switch (task.status) {
        case "SUCCEEDED":
            return "Agenda Google atualizada.";
        case "SCHEDULED":
            return `Agenda Google: a tentativa ${task.attempt - 1} falhou (${failureLabel(task)}); nova tentativa agendada.`;
        case "FAILED":
            return `Agenda Google não atualizada: ${failureLabel(task)}.`;
        case "CANCELLED":
            return `Atualização da agenda Google cancelada. ${task.stopReason ? stopReasonLabel(task.stopReason) : ""}`.trim();
        case "EXPIRED":
            return "Atualização da agenda Google venceu sem ser feita.";
        default:
            return `Agenda Google: ${task.status}.`;
    }
}
export function auditSummary(task) {
    if (task.type === "SYNC_CALENDAR_EVENT")
        return calendarSummary(task);
    switch (task.status) {
        case "SUCCEEDED":
            return task.channel && CHANNEL_META[task.channel].providerId === "SIMULATED"
                ? `${subject(task)} aceito pelo provedor simulado. Nenhuma mensagem real saiu.`
                : `${subject(task)} aceito pelo provedor.`;
        case "SCHEDULED":
            return `${subject(task)}: a tentativa ${task.attempt - 1} falhou (${failureLabel(task)}); nova tentativa agendada.`;
        case "FAILED":
            return `${subject(task)} não saiu: ${failureLabel(task)}.`;
        case "CANCELLED":
            return `${subject(task)} cancelado antes do envio. ${task.stopReason ? stopReasonLabel(task.stopReason) : ""}`.trim();
        case "EXPIRED":
            return `${subject(task)} venceu sem ser enviado.`;
        default:
            return `${subject(task)}: ${task.status}.`;
    }
}
function runInline(planned, at) {
    return transitionTask(transitionTask(planned, "DISPATCHING", { at }), "SUCCEEDED", { at });
}
/** Entrada na trilha do tenant pela mudanca de estado que `source` acabou de sofrer. */
export function auditEffect(source, at) {
    const planned = newInternalTask("WRITE_AUDIT", source, at);
    const last = source.history[source.history.length - 1];
    const audit = {
        id: planned.id,
        organizationId: source.organizationId,
        createdAt: at,
        updatedAt: at,
        createdBy: null,
        updatedBy: null,
        actorType: "SYSTEM",
        actorId: null,
        actorName: AUTOMATION_ACTOR_NAME,
        action: "UPDATE",
        // O atendimento e o recurso: e por ele que a eliminacao a pedido do titular
        // encontra e pseudonimiza esta entrada.
        resource: source.appointmentId
            ? { type: "appointment", id: source.appointmentId }
            : { type: "automationTask", id: source.id },
        summary: auditSummary(source),
        metadata: {
            automationTaskId: source.id,
            taskType: source.type,
            status: source.status,
            attempt: source.attempt,
            channel: source.channel,
            event: source.event,
            code: last?.code ?? null,
        },
        occurredAt: at,
    };
    return { kind: "WRITE_AUDIT", task: runInline(planned, at), audit };
}
function alertCause(task) {
    if (task.status === "EXPIRED")
        return AUTOMATION_QUEUE_STOP_LABELS.TASK_EXPIRED;
    if (task.type === "SYNC_CALENDAR_EVENT") {
        const label = task.failureCode ? DELIVERY_FAILURE_LABELS[task.failureCode] : "Falha sem código";
        if (task.failureCode === "CALENDAR_RECONNECT_REQUIRED" || task.failureCode === "CALENDAR_NOT_PROVISIONED") {
            return `${label}. Reconecte a agenda em Configurações → Google Calendar.`;
        }
        // Repetir e inofensivo aqui: o evento tem id derivado do atendimento.
        return `${label}. Reenvie pela fila de automações para acertar a agenda.`;
    }
    if (task.failureCode === "DISPATCH_INTERRUPTED") {
        return "A execução foi interrompida sem confirmação. Confira com a pessoa antes de repetir: a mensagem pode ter saído.";
    }
    const label = task.failureCode ? DELIVERY_FAILURE_LABELS[task.failureCode] : "Falha sem código";
    return `${label}.`;
}
/** Alerta dentro do painel para a equipe. Nunca sai por canal de clinica. */
export function alertEffect(source, at) {
    const planned = newInternalTask("RAISE_ALERT", source, at);
    const when = source.appointmentStartsAt
        ? ` do atendimento de ${formatDateTime(source.appointmentStartsAt)}`
        : "";
    const alert = {
        id: planned.id,
        organizationId: source.organizationId,
        createdAt: at,
        updatedAt: at,
        createdBy: null,
        updatedBy: null,
        type: "AUTOMATION_FAILURE",
        priority: "ATTENTION",
        status: "UNREAD",
        title: AUTOMATION_TASK_META[source.type].alertTitle,
        body: source.type === "SYNC_CALENDAR_EVENT"
            ? `A agenda Google${when} não foi atualizada. ${alertCause(source)}`
            : `${subject(source)}${when} não saiu. ${alertCause(source)}`,
        professionalId: source.professionalId,
        target: source.appointmentId ? { type: "appointment", id: source.appointmentId } : null,
        channels: ["DASHBOARD"],
        aiDecisionId: null,
        acknowledgedBy: null,
        acknowledgedAt: null,
    };
    return { kind: "RAISE_ALERT", task: runInline(planned, at), alert };
}
