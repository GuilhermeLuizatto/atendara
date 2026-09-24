import { AUTOMATION_TASK_META } from "@/config/automation";
import type { AutomationTask, NotificationDelivery } from "@/types";
import { alertEffect, auditEffect, type InternalEffect } from "./effects";
import { isTaskExpired, isWaitingStatus, transitionTask } from "./tasks";

/** Não encerra envios adquiridos: perder o prazo não prova que nada saiu. */
export function expireWaitingTask(
  task: AutomationTask,
  delivery: NotificationDelivery | null,
  now: string,
): {
  task: AutomationTask;
  delivery: NotificationDelivery | null;
  effects: InternalEffect[];
} | null {
  if (
    AUTOMATION_TASK_META[task.type].executor !== "EXTERNAL" ||
    !isWaitingStatus(task.status) ||
    !isTaskExpired(task, now)
  )
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
