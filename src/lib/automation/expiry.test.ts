import { describe, expect, it } from "vitest";
import { AUTOMATION_TASK_STATUSES, type AutomationTask } from "@/types";
import { expireWaitingTask } from "./expiry";
import { plannedReminder } from "./fixtures";

describe("vencimento independente do executor", () => {
  const { task, delivery } = plannedReminder();
  it("respeita o instante exato da validade e grava alerta e trilha", () => {
    const before = new Date(Date.parse(task.expiresAt) - 1).toISOString();
    expect(expireWaitingTask(task, delivery, before)).toBeNull();
    const result = expireWaitingTask(task, delivery, task.expiresAt)!;
    expect(result.task).toMatchObject({
      status: "EXPIRED",
      stopReason: "TASK_EXPIRED",
      completedAt: task.expiresAt,
    });
    expect(result.delivery).toMatchObject({
      status: "CANCELLED",
      nextAttemptAt: null,
    });
    expect(result.effects.map((effect) => effect.kind)).toEqual([
      "WRITE_AUDIT",
      "RAISE_ALERT",
    ]);
    expect(result.effects[1]).toMatchObject({
      alert: { channels: ["DASHBOARD"], type: "AUTOMATION_FAILURE" },
    });
    expect(
      expireWaitingTask(result.task, result.delivery, task.expiresAt),
    ).toBeNull();
  });
  it.each(
    AUTOMATION_TASK_STATUSES.filter(
      (status) => status !== "PLANNED" && status !== "SCHEDULED",
    ),
  )("não altera %s, mesmo sem retorno depois do prazo", (status) => {
    expect(
      expireWaitingTask({ ...task, status }, delivery, task.expiresAt),
    ).toBeNull();
  });
  it("encerra agendada sem entrega, preservando a tentativa", () => {
    const result = expireWaitingTask(
      { ...task, status: "SCHEDULED", attempt: 2 },
      null,
      task.expiresAt,
    )!;
    expect(result.task.attempt).toBe(2);
    expect(result.delivery).toBeNull();
  });
  it("ignora tarefas internas", () => {
    expect(
      expireWaitingTask(
        { ...task, type: "WRITE_AUDIT" } as AutomationTask,
        null,
        task.expiresAt,
      ),
    ).toBeNull();
  });
});
