import { AUTOMATION_TASK_META } from "@/config/automation";
import type {
  AutomationTask,
  AutomationTaskStatus,
  AutomationTaskType,
  OutboundChannel,
} from "@/types";
import { isLeaseStale, isTaskExpired, isTerminalStatus } from "./tasks";

export interface QueueFilter {
  status: "ALL" | "ATTENTION" | AutomationTaskStatus;
  type: "NOTICES" | "ALL" | AutomationTaskType;
  channel: "ALL" | OutboundChannel;
}

export function taskNeedsAttention(task: AutomationTask, now: string): boolean {
  if (task.status === "FAILED" || task.status === "EXPIRED") return true;
  if (isTerminalStatus(task.status)) return false;
  return (
    isTaskExpired(task, now) ||
    (task.status === "DISPATCHING" && isLeaseStale(task, now))
  );
}

export function filterQueue(
  tasks: readonly AutomationTask[],
  filter: QueueFilter,
  now: string,
): AutomationTask[] {
  return tasks
    .filter(
      (task) =>
        (filter.status === "ALL" ||
          (filter.status === "ATTENTION"
            ? taskNeedsAttention(task, now)
            : task.status === filter.status)) &&
        (filter.type === "ALL" ||
          (filter.type === "NOTICES"
            ? // A agenda Google tambem e externa, mas nao tem canal: nao e aviso.
              AUTOMATION_TASK_META[task.type].executor === "EXTERNAL" && task.channel !== null
            : task.type === filter.type)) &&
        (filter.channel === "ALL" || task.channel === filter.channel),
    )
    .sort(
      (a, b) =>
        Number(taskNeedsAttention(b, now)) -
          Number(taskNeedsAttention(a, now)) ||
        b.createdAt.localeCompare(a.createdAt),
    );
}
