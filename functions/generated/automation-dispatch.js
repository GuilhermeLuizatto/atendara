// Gerado por scripts/build-functions.mjs.
import { AUTOMATION_TASK_META, DISPATCH_CLOCK_SKEW_SECONDS } from "./automation-config.js";
import { applyAttempt } from "./notifications-delivery.js";
import { recheckBeforeSend } from "./notifications-eligibility.js";
import { alertEffect, auditEffect } from "./automation-effects.js";
import { isLeaseStale, isTaskExpired, isTerminalStatus, queueEnqueueAt, transitionTask, } from "./automation-tasks.js";
function cancelledDelivery(delivery, at) {
    return delivery
        ? { ...delivery, status: "CANCELLED", cancelledAt: at, nextAttemptAt: null, updatedAt: at, updatedBy: null }
        : null;
}
function cancel(task, delivery, reason, at) {
    const cancelled = transitionTask(task, "CANCELLED", { at, code: reason, patch: { stopReason: reason } });
    return {
        kind: "STOP",
        task: cancelled,
        delivery: cancelledDelivery(delivery, at),
        effects: [auditEffect(cancelled, at)],
    };
}
export function decideDispatch(input) {
    const { payload, task, now } = input;
    if (!task || task.id !== payload.taskId || task.organizationId !== payload.organizationId) {
        return { kind: "IGNORE", why: "NOT_FOUND" };
    }
    if (isTerminalStatus(task.status))
        return { kind: "IGNORE", why: "TERMINAL" };
    if (payload.attempt !== task.attempt) {
        // Ponteiro de tentativa anterior. Se a corrente ficou sem fila (o pedido a
        // Cloud Tasks falhou depois de gravar o resultado), e a hora de repor.
        return payload.attempt < task.attempt && task.status === "SCHEDULED"
            ? { kind: "REQUEUE", task, at: queueEnqueueAt(task, now) }
            : { kind: "IGNORE", why: "STALE_ATTEMPT" };
    }
    if (task.status === "DISPATCHING") {
        if (!isLeaseStale(task, now))
            return { kind: "BUSY" };
        // A execucao morreu entre adquirir e gravar. Nao se sabe se o envio saiu:
        // falha, alerta e nenhuma tentativa nova.
        const failed = transitionTask(task, "FAILED", {
            at: now,
            code: "DISPATCH_INTERRUPTED",
            patch: { failureCode: "DISPATCH_INTERRUPTED" },
        });
        const delivery = input.delivery
            ? {
                ...input.delivery,
                status: "FAILED",
                failureCode: "DISPATCH_INTERRUPTED",
                nextAttemptAt: null,
                updatedAt: now,
                updatedBy: null,
            }
            : null;
        return { kind: "STOP", task: failed, delivery, effects: [auditEffect(failed, now), alertEffect(failed, now)] };
    }
    if (task.status === "DISPATCHED")
        return { kind: "IGNORE", why: "AWAITING_RESULT" };
    // Tarefa interna nao passa pela fila: nasce e termina no ato que a origina.
    // Um ponteiro que chegue ate aqui nao executa nada.
    if (AUTOMATION_TASK_META[task.type].executor === "INTERNAL") {
        return cancel(task, input.delivery, "NO_EXECUTOR", now);
    }
    if (isTaskExpired(task, now)) {
        const expired = transitionTask(task, "EXPIRED", {
            at: now,
            code: "TASK_EXPIRED",
            patch: { stopReason: "TASK_EXPIRED" },
        });
        return {
            kind: "STOP",
            task: expired,
            delivery: cancelledDelivery(input.delivery, now),
            effects: [auditEffect(expired, now), alertEffect(expired, now)],
        };
    }
    if (Date.parse(task.scheduledFor) - DISPATCH_CLOCK_SKEW_SECONDS * 1000 > Date.parse(now)) {
        return { kind: "REQUEUE", task, at: queueEnqueueAt(task, now) };
    }
    if (!input.delivery)
        return cancel(task, null, "DELIVERY_NOT_FOUND", now);
    if (!input.organization || !input.profession) {
        return cancel(task, input.delivery, "ORGANIZATION_DISABLED", now);
    }
    // As travas de novo, agora, contra o estado atual: consentimento retirado,
    // canal desligado, atendimento cancelado ou remarcado e texto alterado
    // impedem o envio que ja estava planejado.
    const check = recheckBeforeSend({
        organization: input.organization,
        profession: input.profession,
        appointment: input.appointment,
        client: input.client,
        professionalName: input.professionalName,
        delivery: input.delivery,
        plannedForStartsAt: task.appointmentStartsAt,
    });
    if (!check.ok)
        return cancel(task, input.delivery, check.reason, now);
    const scheduled = task.status === "PLANNED" ? transitionTask(task, "SCHEDULED", { at: now }) : task;
    const dispatching = transitionTask(scheduled, "DISPATCHING", { at: now });
    return {
        kind: "SEND",
        task: dispatching,
        delivery: { ...input.delivery, status: "SENDING", updatedAt: now, updatedBy: null },
        // Destino e texto existem so aqui, na memoria do despachante. Nenhum dos
        // dois e gravado.
        request: {
            deliveryId: input.delivery.id,
            channel: input.delivery.channel,
            destination: check.destination,
            body: check.body,
            attempt: task.attempt,
        },
    };
}
export function completeDispatch(input) {
    const { task, delivery, result, now } = input;
    const dispatched = transitionTask(task, "DISPATCHED", { at: now });
    const outcome = applyAttempt(delivery, result, now);
    const nextDelivery = { ...delivery, ...outcome, updatedAt: now, updatedBy: null };
    if (outcome.status === "SENT") {
        const done = transitionTask(dispatched, "SUCCEEDED", {
            at: now,
            patch: { providerMessageId: result.providerMessageId, failureCode: null },
        });
        return { task: done, delivery: nextDelivery, effects: [auditEffect(done, now)], requeueAt: null };
    }
    if (outcome.status === "PLANNED" && outcome.nextAttemptAt) {
        const retry = transitionTask(dispatched, "SCHEDULED", {
            at: now,
            code: outcome.failureCode,
            patch: { attempt: task.attempt + 1, scheduledFor: outcome.nextAttemptAt, failureCode: outcome.failureCode },
        });
        return {
            task: retry,
            delivery: nextDelivery,
            effects: [auditEffect(retry, now)],
            requeueAt: queueEnqueueAt(retry, now),
        };
    }
    const failed = transitionTask(dispatched, "FAILED", {
        at: now,
        code: outcome.failureCode,
        patch: { failureCode: outcome.failureCode },
    });
    return {
        task: failed,
        delivery: nextDelivery,
        effects: [auditEffect(failed, now), alertEffect(failed, now)],
        requeueAt: null,
    };
}
