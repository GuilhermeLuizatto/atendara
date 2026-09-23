import { describe, expect, it } from "vitest";
import type { AutomationTask } from "@/types";
import { plannedReminder } from "./fixtures";
import {
  filterQueue,
  taskNeedsAttention,
  type QueueFilter,
} from "./queue-view";

const { task } = plannedReminder();
const now = task.expiresAt;
const all: QueueFilter = { status: "ALL", type: "ALL", channel: "ALL" };
const make = (id: string, patch: Partial<AutomationTask>) => ({
  ...task,
  id,
  ...patch,
});

describe("leitura operacional da fila", () => {
  it("destaca espera vencida e retorno incerto, sem inventar um novo estado", () => {
    const waiting = make("espera", { status: "SCHEDULED" });
    const uncertain = make("retorno", { status: "DISPATCHED" });
    expect(
      filterQueue(
        [waiting, uncertain],
        { ...all, status: "ATTENTION" },
        now,
      ).map((item) => item.status),
    ).toEqual(["SCHEDULED", "DISPATCHED"]);
    expect(taskNeedsAttention(make("fim", { status: "SUCCEEDED" }), now)).toBe(
      false,
    );
    expect(
      taskNeedsAttention(make("cancelada", { status: "CANCELLED" }), now),
    ).toBe(false);
  });
  it("separa avisos de tarefas internas e combina os três filtros", () => {
    const rows = [
      make("sms", { status: "FAILED", channel: "SMS" }),
      make("email", { status: "FAILED", channel: "EMAIL" }),
      make("trilha", { type: "WRITE_AUDIT", status: "SUCCEEDED" }),
    ];
    expect(
      filterQueue(
        rows,
        { status: "FAILED", type: "SEND_REMINDER", channel: "SMS" },
        now,
      ).map((item) => item.id),
    ).toEqual(["sms"]);
    expect(filterQueue(rows, { ...all, type: "NOTICES" }, now)).toHaveLength(2);
    expect(filterQueue(rows, all, now)).toHaveLength(3);
  });
  it("traz problemas antes do histórico e não modifica a lista original", () => {
    const rows = [
      make("nova", { status: "SUCCEEDED", createdAt: now }),
      make("falha", { status: "FAILED" }),
    ];
    expect(filterQueue(rows, all, now)[0].id).toBe("falha");
    expect(rows[0].id).toBe("nova");
  });
  it("destaca execução interrompida antes mesmo de expirar a validade", () => {
    const active = make("ativa", {
      status: "DISPATCHING",
      dispatchingSince: task.createdAt,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(taskNeedsAttention(active, now)).toBe(true);
    expect(taskNeedsAttention({ ...active, dispatchingSince: now }, now)).toBe(
      false,
    );
  });
});
