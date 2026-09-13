import { describe, expect, it } from "vitest";

import { AUTOMATION_TRANSITIONS, DISPATCH_LEASE_SECONDS, TERMINAL_AUTOMATION_STATUSES } from "@/config/automation";
import { FICTITIOUS } from "@/lib/notifications/fixtures";
import { AUTOMATION_TASK_STATUSES, AUTOMATION_TASK_TYPES, type AutomationTask } from "@/types";

import { ANCHOR, APPOINTMENT_START, REMINDER_AT, plannedReminder } from "./fixtures";
import {
  AutomationTransitionError,
  blockingNoticeKeys,
  canTransition,
  dispatchPayloadFor,
  isLeaseStale,
  isTaskExpired,
  newInternalTask,
  noticeExpiresAt,
  noticeTaskId,
  queueEnqueueAt,
  queueTaskName,
  transitionTask,
} from "./tasks";

const at = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

function reminder(): AutomationTask {
  return plannedReminder().task;
}

describe("a tarefa de aviso", () => {
  it("nasce planejada, na tentativa 1, com id igual a chave do aviso e sem texto nem contato", () => {
    const { task, delivery } = plannedReminder();

    expect(task).toMatchObject({
      type: "SEND_REMINDER",
      status: "PLANNED",
      attempt: 1,
      maxAttempts: 3,
      scheduledFor: REMINDER_AT,
      appointmentStartsAt: APPOINTMENT_START,
      deliveryId: task.id,
      idempotencyKey: task.id,
      history: [{ from: null, to: "PLANNED", at: ANCHOR, attempt: 1, code: null }],
    });
    expect(delivery.id).toBe(task.id);
    const stored = JSON.stringify([task, delivery]);
    expect(stored).not.toContain(FICTITIOUS.phone);
    expect(stored).not.toContain("Alex");
    expect(Object.keys(delivery)).not.toContain("body");
  });

  it("vale ate o horario planejado mais a janela de atraso, e nunca depois do inicio do atendimento", () => {
    expect(noticeExpiresAt("2026-09-10T12:00:00.000Z", "2026-09-11T00:00:00.000Z")).toBe("2026-09-10T14:00:00.000Z");
    expect(noticeExpiresAt("2026-09-10T23:00:00.000Z", "2026-09-11T00:00:00.000Z")).toBe("2026-09-11T00:00:00.000Z");
    const task = reminder();
    expect(isTaskExpired(task, at(task.expiresAt, -1))).toBe(false);
    expect(isTaskExpired(task, task.expiresAt)).toBe(true);
  });
});

describe("mudanca de estado", () => {
  it("percorre o caminho externo inteiro e grava cada passo no historico", () => {
    let task = reminder();
    for (const to of ["SCHEDULED", "DISPATCHING", "DISPATCHED", "SUCCEEDED"] as const) {
      task = transitionTask(task, to, { at: REMINDER_AT });
    }
    expect(task.history.map((step) => [step.from, step.to])).toEqual([
      [null, "PLANNED"],
      ["PLANNED", "SCHEDULED"],
      ["SCHEDULED", "DISPATCHING"],
      ["DISPATCHING", "DISPATCHED"],
      ["DISPATCHED", "SUCCEEDED"],
    ]);
    expect(task.completedAt).toBe(REMINDER_AT);
    expect(task.dispatchingSince).toBeNull();
  });

  it("estado terminal nao volta para nada, em nenhum tipo", () => {
    for (const type of AUTOMATION_TASK_TYPES) {
      for (const from of TERMINAL_AUTOMATION_STATUSES) {
        for (const to of AUTOMATION_TASK_STATUSES) {
          expect(canTransition(type, from, to), `${type} ${from} -> ${to}`).toBe(false);
        }
      }
    }
    const cancelled = transitionTask(reminder(), "CANCELLED", { at: ANCHOR });
    expect(() => transitionTask(cancelled, "CANCELLED", { at: ANCHOR })).toThrow(AutomationTransitionError);
  });

  it("recusa com erro nomeado o que a tabela nao lista", () => {
    const cancelled = transitionTask(reminder(), "CANCELLED", { at: ANCHOR, code: "CONSENT_REVOKED" });
    expect(() => transitionTask(cancelled, "SCHEDULED", { at: ANCHOR })).toThrow(AutomationTransitionError);
    // Aviso nao pula a fila nem conclui sem ter sido entregue ao executor.
    expect(() => transitionTask(reminder(), "DISPATCHING", { at: ANCHOR })).toThrow(AutomationTransitionError);
    const dispatching = transitionTask(transitionTask(reminder(), "SCHEDULED", { at: ANCHOR }), "DISPATCHING", { at: ANCHOR });
    expect(() => transitionTask(dispatching, "SUCCEEDED", { at: ANCHOR })).toThrow(AutomationTransitionError);
  });

  it("tarefa interna nao passa pela fila nem por executor externo", () => {
    const audit = newInternalTask("WRITE_AUDIT", reminder(), ANCHOR);
    expect(canTransition("WRITE_AUDIT", "PLANNED", "SCHEDULED")).toBe(false);
    expect(canTransition("RAISE_ALERT", "DISPATCHING", "DISPATCHED")).toBe(false);
    const done = transitionTask(transitionTask(audit, "DISPATCHING", { at: ANCHOR }), "SUCCEEDED", { at: ANCHOR });
    expect(done.status).toBe("SUCCEEDED");
    expect(() => newInternalTask("SEND_REMINDER", reminder(), ANCHOR)).toThrow();
  });

  it("a tentativa so avanca na volta de falha retentavel, de uma em uma e ate o limite", () => {
    const dispatched = ["SCHEDULED", "DISPATCHING", "DISPATCHED"].reduce(
      (task, to) => transitionTask(task, to as AutomationTask["status"], { at: REMINDER_AT }),
      reminder(),
    );
    expect(() => transitionTask(dispatched, "SCHEDULED", { at: REMINDER_AT })).toThrow(AutomationTransitionError);
    expect(() => transitionTask(dispatched, "SCHEDULED", { at: REMINDER_AT, patch: { attempt: 3 } })).toThrow(
      AutomationTransitionError,
    );
    expect(() =>
      transitionTask({ ...dispatched, attempt: 3 }, "SCHEDULED", { at: REMINDER_AT, patch: { attempt: 4 } }),
    ).toThrow(AutomationTransitionError);
    expect(() => transitionTask(reminder(), "CANCELLED", { at: ANCHOR, patch: { attempt: 2 } })).toThrow(
      AutomationTransitionError,
    );
    const retry = transitionTask(dispatched, "SCHEDULED", { at: REMINDER_AT, patch: { attempt: 2 } });
    expect(retry.history.at(-1)).toMatchObject({ from: "DISPATCHED", to: "SCHEDULED", attempt: 2 });
  });

  it("toda regra de transicao da tabela e aceita pelo mecanismo", () => {
    for (const rule of AUTOMATION_TRANSITIONS) {
      const type = rule.executors.includes("EXTERNAL") ? "SEND_REMINDER" : "WRITE_AUDIT";
      expect(canTransition(type, rule.from, rule.to), `${rule.from} -> ${rule.to}`).toBe(true);
    }
  });
});

describe("identidade e reentrega", () => {
  it("replanejar cai no mesmo id; aviso cancelado ou vencido nao volta e o novo ganha sufixo", () => {
    const key = "atendimento-1_APPOINTMENT_REMINDER_SMS_202609102300";
    expect(noticeTaskId(key, [])).toBe(key);
    expect(noticeTaskId(key, [{ id: key }])).toBe(`${key}_2`);
    expect(noticeTaskId(key, [{ id: key }, { id: `${key}_2` }])).toBe(`${key}_3`);
  });

  it("so o que nao foi cancelado nem venceu impede planejar de novo", () => {
    const task = reminder();
    expect(blockingNoticeKeys([task])).toEqual([task.idempotencyKey]);
    expect(blockingNoticeKeys([{ ...task, status: "SUCCEEDED" }])).toEqual([task.idempotencyKey]);
    expect(blockingNoticeKeys([{ ...task, status: "CANCELLED" }, { ...task, status: "EXPIRED" }])).toEqual([]);
    expect(blockingNoticeKeys([newInternalTask("WRITE_AUDIT", task, ANCHOR)])).toEqual([]);
  });

  it("tarefa interna tem id derivado da origem e do passo que a gerou", () => {
    const task = reminder();
    const scheduled = transitionTask(task, "SCHEDULED", { at: ANCHOR });
    expect(newInternalTask("WRITE_AUDIT", scheduled, ANCHOR).id).toBe(`${task.id}_WRITE_AUDIT_2`);
    expect(newInternalTask("WRITE_AUDIT", scheduled, ANCHOR).id).toBe(newInternalTask("WRITE_AUDIT", scheduled, ANCHOR).id);
    expect(newInternalTask("RAISE_ALERT", scheduled, ANCHOR)).toMatchObject({ sourceTaskId: task.id, deliveryId: null });
  });
});

describe("fila", () => {
  it("pede o horario exato; alem de 29 dias, o despertar e arredondado ao dia; passado vira agora", () => {
    const now = "2026-09-01T10:30:00.000Z";
    expect(queueEnqueueAt({ scheduledFor: "2026-09-10T23:00:00.000Z" }, now)).toBe("2026-09-10T23:00:00.000Z");
    expect(queueEnqueueAt({ scheduledFor: "2026-12-01T10:00:00.000Z" }, now)).toBe("2026-09-30T00:00:00.000Z");
    expect(queueEnqueueAt({ scheduledFor: "2026-12-01T10:00:00.000Z" }, "2026-09-01T18:00:00.000Z")).toBe(
      "2026-09-30T00:00:00.000Z",
    );
    expect(queueEnqueueAt({ scheduledFor: "2026-08-01T10:00:00.000Z" }, now)).toBe(now);
  });

  it("o nome na fila e estavel por tentativa e horario, e so usa caracteres aceitos", () => {
    const task = { ...reminder(), organizationId: "4f1c-org id/estranha" };
    const name = queueTaskName(task, REMINDER_AT);
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,500}$/);
    expect(queueTaskName(task, REMINDER_AT)).toBe(name);
    expect(queueTaskName({ ...task, attempt: 2 }, REMINDER_AT)).not.toBe(name);
    expect(queueTaskName(task, at(REMINDER_AT, 5))).not.toBe(name);
  });

  it("o ponteiro so leva organizacao, tarefa e tentativa", () => {
    const task = reminder();
    expect(dispatchPayloadFor(task)).toEqual({ version: 1, organizationId: task.organizationId, taskId: task.id, attempt: 1 });
  });

  it("execucao em andamento vale ate o prazo e depois e dada como interrompida", () => {
    const since = REMINDER_AT;
    expect(isLeaseStale({ dispatchingSince: since }, at(since, DISPATCH_LEASE_SECONDS / 60))).toBe(false);
    expect(isLeaseStale({ dispatchingSince: since }, at(since, DISPATCH_LEASE_SECONDS / 60 + 1))).toBe(true);
    expect(isLeaseStale({ dispatchingSince: null }, since)).toBe(true);
  });
});
