// Gerado por scripts/build-functions.mjs.
import { AUTOMATION_TASK_META } from "./automation-config.js";
import { alertEffect, auditEffect } from "./automation-effects.js";
import { isTaskExpired, isWaitingStatus, transitionTask } from "./automation-tasks.js";
/** Não encerra envios adquiridos: perder o prazo não prova que nada saiu. */
export function expireWaitingTask(task, delivery, now) {
    if (AUTOMATION_TASK_META[task.type].executor !== "EXTERNAL" ||
        !isWaitingStatus(task.status) ||
        !isTaskExpired(task, now))
        return null;
    const expired = transitionTask(task, "EXPIRED", {
        at: now,
        code: "TASK_EXPIRED",
        patch: { stopReason: "TASK_EXPIRED" },
    });
    return {
        task: expired,
        delivery: delivery
            ? {
                ...delivery,
                status: "CANCELLED",
                cancelledAt: now,
                nextAttemptAt: null,
                updatedAt: now,
                updatedBy: null,
            }
            : null,
        effects: [auditEffect(expired, now), alertEffect(expired, now)],
    };
}
