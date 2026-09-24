// Gerado por scripts/build-functions.mjs.
import { AUTOMATION_TASK_META, DISPATCH_CLOCK_SKEW_SECONDS } from "./automation-config.js";
import { applyAttempt } from "./notifications-delivery.js";
import { recheckBeforeSend } from "./notifications-eligibility.js";
import { alertEffect, auditEffect } from "./automation-effects.js";
import { expireWaitingTask } from "./automation-expiry.js";
import { outboundBlock, switchRetryAt } from "./automation-emergency.js";
import { isLeaseStale, isTerminalStatus, queueEnqueueAt, transitionTask, } from "./automation-tasks.js";
function cancelledDelivery(delivery, at) {
    return delivery
        ? { ...delivery, status: "CANCELLED", cancelledAt: at, nextAttemptAt: null, updatedAt: at, updatedBy: null }
        : null;
}
export function cancel(task, delivery, reason, at) {
    const cancelled = transitionTask(task, "CANCELLED", { at, code: reason, patch: { stopReason: reason } });
    return {
        kind: "STOP",
        task: cancelled,
        delivery: cancelledDelivery(delivery, at),
        effects: [auditEffect(cancelled, at)],
    };
}
/**
 * O que vale para todo tipo executado pela Cloud Tasks: tarefa e tentativa
 * certas, execucao em andamento, vencimento, horario e chave de emergencia.
 * `CONTINUE` devolve a tarefa pronta para as travas proprias de cada tipo.
 */
export function guardDispatch(input) {
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
    const expired = expireWaitingTask(task, input.delivery, now);
    if (expired)
        return { kind: "STOP", ...expired };
    if (Date.parse(task.scheduledFor) - DISPATCH_CLOCK_SKEW_SECONDS * 1000 > Date.parse(now)) {
        return { kind: "REQUEUE", task, at: queueEnqueueAt(task, now) };
    }
    // A chave de emergência é conferida aqui, imediatamente antes do envio, e
    // não no planejamento: desligar a chave tem de parar o que já está na fila.
    // A tarefa NÃO é cancelada — fica esperando, e volta sozinha ao religar.
    const blocked = outboundBlock({
        global: input.switches?.global ?? null,
        organization: input.switches?.organization ?? null,
    });
    if (blocked)
        return { kind: "REQUEUE", task, at: switchRetryAt(now) };
    return { kind: "CONTINUE", task };
}
export function decideDispatch(input) {
    const guarded = guardDispatch(input);
    if (guarded.kind !== "CONTINUE")
        return guarded;
    const { task } = guarded;
    const { now } = input;
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
        sender: input.sender,
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
            ...(input.delivery.channel === "WHATSAPP" && input.sender?.providerSenderId
                ? { providerSenderId: input.sender.providerSenderId }
                : {}),
            body: check.body,
            attempt: task.attempt,
            taskId: task.id,
            organizationId: task.organizationId,
            idempotencyKey: task.idempotencyKey,
            expiresAt: task.expiresAt,
            template: check.template,
        },
    };
}
/**
 * A tarefa saiu das nossas maos: `DISPATCHING` -> `DISPATCHED` (Fase 3, 13.3).
 *
 * Com provedor simulado isso e um instante dentro de `completeDispatch`. Com a
 * ponte do n8n e um estado de espera de verdade: a entrega continua `SENDING`
 * ate o retorno assinado chegar. **Marcar `SENT` aqui seria dizer que o
 * WhatsApp entregou porque o n8n atendeu o telefone.**
 */
export function handoffDispatch(task, now) {
    return transitionTask(task, "DISPATCHED", { at: now });
}
/**
 * Aplica um resultado a uma tarefa **ja entregue ao executor**. E o mesmo
 * caminho para o resultado sincrono do provedor simulado e para o que volta
 * pelo `automationCallback`: um so lugar decide sucesso, nova tentativa e
 * falha, e um so lugar grava trilha e alerta.
 */
export function applyDispatchResult(input) {
    const { task: dispatched, delivery, result, now } = input;
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
            patch: { attempt: dispatched.attempt + 1, scheduledFor: outcome.nextAttemptAt, failureCode: outcome.failureCode },
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
/**
 * Provedor sincrono: entrega e resultado no mesmo ato. Continua sendo o caminho
 * do simulado e de qualquer provedor que responda na hora.
 */
export function completeDispatch(input) {
    return applyDispatchResult({ ...input, task: handoffDispatch(input.task, input.now) });
}
