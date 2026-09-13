import { describe, expect, it } from "vitest";

import {
  APPOINTMENT_NOTIFICATION_EVENTS,
  AUTOMATION_TASK_STATUSES,
  AUTOMATION_TASK_TYPES,
} from "@/types";

import {
  AUTOMATION_TASK_META,
  AUTOMATION_TRANSITIONS,
  NOTICE_TASK_TYPES,
  TERMINAL_AUTOMATION_STATUSES,
  WAITING_AUTOMATION_STATUSES,
} from "./automation";

describe("politica da fila de automacao", () => {
  it("alerta, trilha e mensagem recebida sao internos: nunca saem do Atendara", () => {
    for (const type of ["RAISE_ALERT", "WRITE_AUDIT", "PROCESS_INBOUND_MESSAGE"] as const) {
      expect(AUTOMATION_TASK_META[type].executor, type).toBe("INTERNAL");
    }
    expect(Object.keys(AUTOMATION_TASK_META).sort()).toEqual([...AUTOMATION_TASK_TYPES].sort());
  });

  it("todo evento com tarefa aponta para um tipo externo, e so confirmacao e lembrete tem tarefa", () => {
    for (const event of APPOINTMENT_NOTIFICATION_EVENTS) {
      const type = NOTICE_TASK_TYPES[event];
      if (type) expect(AUTOMATION_TASK_META[type].executor, event).toBe("EXTERNAL");
    }
    expect(NOTICE_TASK_TYPES).toEqual({
      APPOINTMENT_SCHEDULED: null,
      APPOINTMENT_REMINDER: "SEND_REMINDER",
      APPOINTMENT_CONFIRMED: "CONFIRM_APPOINTMENT",
      APPOINTMENT_CANCELLED: null,
    });
  });

  it("nenhuma transicao sai de estado terminal, e toda transicao cita estados conhecidos", () => {
    for (const rule of AUTOMATION_TRANSITIONS) {
      expect(TERMINAL_AUTOMATION_STATUSES).not.toContain(rule.from);
      expect(AUTOMATION_TASK_STATUSES).toContain(rule.from);
      expect(AUTOMATION_TASK_STATUSES).toContain(rule.to);
      expect(rule.executors.length).toBeGreaterThan(0);
    }
  });

  it("so o que ainda nao foi adquirido pode ser cancelado pela agenda", () => {
    for (const status of WAITING_AUTOMATION_STATUSES) {
      expect(TERMINAL_AUTOMATION_STATUSES).not.toContain(status);
    }
    expect(WAITING_AUTOMATION_STATUSES).not.toContain("DISPATCHING");
    expect(WAITING_AUTOMATION_STATUSES).not.toContain("DISPATCHED");
  });
});
