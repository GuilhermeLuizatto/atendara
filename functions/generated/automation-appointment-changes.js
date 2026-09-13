// Gerado por scripts/build-functions.mjs.
import { NOTICE_TASK_TYPES } from "./automation-config.js";
import { planAppointmentNotifications, toDeliveryDocument, } from "./notifications-planner.js";
import { auditEffect } from "./automation-effects.js";
import { blockingNoticeKeys, isWaitingStatus, newNoticeTask, noticeTaskId, transitionTask, } from "./automation-tasks.js";
const INACTIVE = ["CANCELLED", "NO_SHOW"];
/** Os eventos da agenda que uma escrita representa. */
export function appointmentNoticeEvents(before, after) {
    if (!after)
        return [];
    if (!before)
        return ["APPOINTMENT_SCHEDULED", "APPOINTMENT_REMINDER"];
    const events = [];
    if (after.status === "CONFIRMED" && before.status !== "CONFIRMED") {
        events.push("APPOINTMENT_CONFIRMED");
    }
    // O lembrete deriva do horario e de quem e atendido: mudar um dos dois pede
    // um lembrete novo, e o antigo e cancelado na primeira parte.
    if (after.startsAt !== before.startsAt || after.clientId !== before.clientId) {
        events.push("APPOINTMENT_REMINDER");
    }
    if (after.status === "CANCELLED" && before.status !== "CANCELLED") {
        events.push("APPOINTMENT_CANCELLED");
    }
    return events;
}
function stopReasonFor(task, current) {
    if (!current)
        return "APPOINTMENT_NOT_FOUND";
    if (INACTIVE.includes(current.status))
        return "APPOINTMENT_CANCELLED";
    if (task.appointmentStartsAt !== current.startsAt)
        return "APPOINTMENT_RESCHEDULED";
    if (task.clientId !== current.clientId)
        return "APPOINTMENT_CLIENT_CHANGED";
    return null;
}
function cancelledDelivery(delivery, at) {
    return {
        ...delivery,
        status: "CANCELLED",
        cancelledAt: at,
        nextAttemptAt: null,
        updatedAt: at,
        updatedBy: null,
    };
}
export function planAppointmentChange(input) {
    const plan = { created: [], stopped: [], effects: [], skipped: [] };
    // Organizacao ausente ou em exclusao: nada a gravar. Escrever agora
    // ressuscitaria documentos que a exclusao esta apagando.
    if (!input.organization || !input.profession)
        return plan;
    const at = input.changedAt;
    const deliveries = new Map(input.deliveries.map((delivery) => [delivery.id, delivery]));
    const known = new Map(input.tasks.map((task) => [task.id, task]));
    // 1. O que deixou de valer.
    for (const task of input.tasks) {
        if (task.deliveryId === null || !isWaitingStatus(task.status))
            continue;
        const reason = stopReasonFor(task, input.current);
        if (!reason)
            continue;
        const stopped = transitionTask(task, "CANCELLED", {
            at,
            code: reason,
            patch: { stopReason: reason },
        });
        const delivery = deliveries.get(task.deliveryId);
        plan.stopped.push({ task: stopped, delivery: delivery ? cancelledDelivery(delivery, at) : null });
        plan.effects.push(auditEffect(stopped, at));
        known.set(stopped.id, stopped);
    }
    // 2. O que o evento acrescenta.
    const current = input.current;
    if (!current || !input.client || INACTIVE.includes(current.status))
        return plan;
    for (const event of appointmentNoticeEvents(input.before, input.after)) {
        // Confirmacao desfeita por uma escrita posterior nao vira aviso atrasado.
        if (event === "APPOINTMENT_CONFIRMED" && current.status !== "CONFIRMED")
            continue;
        const type = NOTICE_TASK_TYPES[event];
        const result = planAppointmentNotifications({
            organization: input.organization,
            profession: input.profession,
            appointment: current,
            client: input.client,
            professionalName: input.professionalName,
            event,
            now: at,
            existingDeliveryIds: blockingNoticeKeys([...known.values()]),
        });
        plan.skipped.push(...result.skipped);
        // O portao ja recusa evento sem tipo (`EVENT_WITHOUT_AUTOMATION`).
        if (!type)
            continue;
        for (const planned of result.planned) {
            const id = noticeTaskId(planned.id, [...known.values()]);
            const task = newNoticeTask({
                id,
                type,
                organizationId: input.organization.id,
                planned,
                appointmentStartsAt: current.startsAt,
                at,
            });
            // Nasceria vencido: confirmacao registrada com o atendimento ja comecado.
            if (Date.parse(task.expiresAt) <= Date.parse(task.scheduledFor)) {
                plan.skipped.push({ ruleId: planned.ruleId, channel: planned.channel, reason: "SCHEDULE_IN_THE_PAST" });
                continue;
            }
            const delivery = {
                ...toDeliveryDocument(planned, input.organization.id, at, null),
                id,
            };
            plan.created.push({ task, delivery });
            known.set(id, task);
        }
    }
    return plan;
}
