import { describe, expect, it } from "vitest";

import { CALENDAR_SYNC_VALIDITY_MINUTES } from "@/config/automation";
import { CALENDAR_PRIVATE_EVENT_TITLE, GOOGLE_CALENDAR_FREEBUSY_SCOPE, GOOGLE_CALENDAR_SCOPES } from "@/config/calendar";
import { RETRY_POLICY } from "@/config/notifications";
import { getProfession } from "@/config/professions";
import { appointment, organization } from "@/lib/notifications/fixtures";
import type { AutomationTask } from "@/types";

import {
  applyCalendarResult,
  calendarEventId,
  calendarSyncKey,
  canWriteCalendar,
  decideCalendarDispatch,
  newCalendarSyncTask,
  planCalendarBackfill,
  planCalendarSync,
  type CalendarDispatchInput,
  type CalendarWriteConnection,
} from "./calendar-sync";
import { ANCHOR } from "./fixtures";
import { dispatchPayloadFor, transitionTask } from "./tasks";

const connected: CalendarWriteConnection = {
  status: "CONNECTED",
  scopes: [...GOOGLE_CALENDAR_SCOPES],
  calendarId: "agenda-atendara@group.calendar.google.com",
  generation: "geracao-1",
};

function plan(overrides: Partial<Parameters<typeof planCalendarSync>[0]> = {}) {
  return planCalendarSync({
    organizationId: "org-teste",
    appointmentId: "atendimento-1",
    before: null,
    after: appointment(),
    connections: { "prof-1": connected },
    tasks: [],
    at: ANCHOR,
    ...overrides,
  });
}

function scheduledTask(): AutomationTask {
  const task = newCalendarSyncTask({
    id: calendarSyncKey("atendimento-1", "prof-1"),
    organizationId: "org-teste",
    appointmentId: "atendimento-1",
    professionalId: "prof-1",
    appointmentStartsAt: appointment().startsAt,
    at: ANCHOR,
  });
  return transitionTask(task, "SCHEDULED", { at: ANCHOR });
}

function dispatchInput(overrides: Partial<CalendarDispatchInput> = {}): CalendarDispatchInput {
  const task = overrides.task ?? scheduledTask();
  const org = organization({ profession: "PSYCHOLOGIST" });
  return {
    payload: dispatchPayloadFor(task),
    task,
    organization: org,
    profession: getProfession("PSYCHOLOGIST"),
    appointment: appointment(),
    connection: connected,
    ownerLinked: true,
    now: ANCHOR,
    ...overrides,
  };
}

describe("quando a agenda Google pode receber escrita", () => {
  it("exige conexão ativa, escopo de escrita, agenda criada e geração", () => {
    expect(canWriteCalendar(connected)).toBe(true);
    expect(canWriteCalendar(null)).toBe(false);
    expect(canWriteCalendar({ ...connected, status: "ERROR" })).toBe(false);
    // Conexão antiga, anterior à escrita: só lia ocupado.
    expect(canWriteCalendar({ ...connected, scopes: [GOOGLE_CALENDAR_FREEBUSY_SCOPE] })).toBe(false);
    expect(canWriteCalendar({ ...connected, calendarId: null })).toBe(false);
  });
});

describe("planejar a partir de uma escrita na agenda", () => {
  it("atendimento novo gera uma tarefa sem dado de quem é atendido", () => {
    const [task] = plan();
    expect(task).toMatchObject({
      type: "SYNC_CALENDAR_EVENT",
      status: "PLANNED",
      appointmentId: "atendimento-1",
      professionalId: "prof-1",
      clientId: null,
      channel: null,
      deliveryId: null,
      maxAttempts: RETRY_POLICY.maxAttempts,
    });
    expect(Date.parse(task.expiresAt) - Date.parse(ANCHOR)).toBe(CALENDAR_SYNC_VALIDITY_MINUTES * 60_000);
    expect(JSON.stringify(task)).not.toContain("Alex");
  });

  it("sem conexão apta, nada é planejado", () => {
    expect(plan({ connections: {} })).toEqual([]);
    expect(plan({ connections: { "prof-1": { ...connected, status: "REVOKED" } } })).toEqual([]);
  });

  it("mudança que não aparece no evento não gera tarefa", () => {
    const before = appointment();
    expect(plan({ before, after: { ...before, administrativeNotes: "anotação interna" } })).toEqual([]);
  });

  it("remarcar, cancelar e trocar o nome geram tarefa", () => {
    const before = appointment();
    expect(plan({ before, after: { ...before, startsAt: "2026-09-12T00:00:00.000Z" } })).toHaveLength(1);
    expect(plan({ before, after: { ...before, status: "CANCELLED" } })).toHaveLength(1);
    expect(plan({ before, after: { ...before, clientName: "Titular pseudonimizado" } })).toHaveLength(1);
    expect(plan({ before, after: null })).toHaveLength(1);
  });

  it("trocar de profissional acerta as duas agendas", () => {
    const before = appointment();
    const tasks = plan({
      before,
      after: { ...before, professionalId: "prof-2" },
      connections: { "prof-1": connected, "prof-2": { ...connected, calendarId: "outra" } },
    });
    expect(tasks.map((task) => task.professionalId).sort()).toEqual(["prof-1", "prof-2"]);
  });

  it("tarefa esperando absorve a mudança; em execução, nasce outra", () => {
    const before = appointment();
    const after = { ...before, startsAt: "2026-09-12T00:00:00.000Z" };
    const waiting = scheduledTask();
    expect(plan({ before, after, tasks: [waiting] })).toEqual([]);

    const running = transitionTask(waiting, "DISPATCHING", { at: ANCHOR });
    const [next] = plan({ before, after, tasks: [running] });
    expect(next.id).toBe(`${calendarSyncKey("atendimento-1", "prof-1")}_2`);
  });
});

describe("ao conectar", () => {
  it("envia só os atendimentos ativos do profissional, sem repetir o que já espera", () => {
    const tasks = planCalendarBackfill({
      organizationId: "org-teste",
      professionalId: "prof-1",
      appointments: [
        appointment({ id: "a1" }),
        appointment({ id: "a2", status: "CANCELLED" }),
        appointment({ id: "a3", professionalId: "prof-2" }),
        appointment({ id: "a4" }),
      ],
      waiting: [{ ...scheduledTask(), idempotencyKey: calendarSyncKey("a4", "prof-1") }],
      at: ANCHOR,
    });
    expect(tasks.map((task) => task.appointmentId)).toEqual(["a1"]);
    expect(tasks[0].id).toBe(`${calendarSyncKey("a1", "prof-1")}_${Date.parse(ANCHOR)}`);
  });
});

describe("id do evento no Google", () => {
  it("é estável, só usa o alfabeto aceito e não colide entre atendimentos", () => {
    const id = calendarEventId("atendimento-1");
    expect(id).toBe(calendarEventId("atendimento-1"));
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(calendarEventId("atendimento-2")).not.toBe(id);
  });
});

describe("despachar", () => {
  it("atendimento ativo vira evento pelo grau de exposição da profissão", () => {
    const step = decideCalendarDispatch(dispatchInput());
    expect(step.kind).toBe("SYNC");
    if (step.kind !== "SYNC") return;
    expect(step.task.status).toBe("DISPATCHING");
    // Psicologia: só o horário, nem nome nem tipo de atendimento.
    expect(step.event).toEqual({
      summary: CALENDAR_PRIVATE_EVENT_TITLE,
      startsAt: appointment().startsAt,
      endsAt: appointment().endsAt,
      description: null,
    });
    expect(step.calendarId).toBe(connected.calendarId);
    expect(step.eventId).toBe(calendarEventId("atendimento-1"));
  });

  it("cancelado, apagado ou de outro profissional vira apagar", () => {
    for (const current of [
      appointment({ status: "CANCELLED" }),
      appointment({ status: "NO_SHOW" }),
      appointment({ professionalId: "prof-2" }),
      null,
    ]) {
      const step = decideCalendarDispatch(dispatchInput({ appointment: current }));
      expect(step.kind === "SYNC" && step.event).toBe(null);
    }
  });

  it("conexão caída ou vínculo perdido cancela sem escrever", () => {
    for (const overrides of [
      { connection: { ...connected, status: "REVOKED" as const } },
      { connection: null },
      { ownerLinked: false },
    ]) {
      const step = decideCalendarDispatch(dispatchInput(overrides));
      expect(step.kind).toBe("STOP");
      if (step.kind === "STOP") expect(step.task.stopReason).toBe("CALENDAR_NOT_CONNECTED");
    }
  });

  it("chave de emergência segura a tarefa sem cancelar", () => {
    const step = decideCalendarDispatch(
      dispatchInput({ switches: { organization: { enabled: false, reason: null, changedAt: null, changedBy: null }, global: null } }),
    );
    expect(step.kind).toBe("REQUEUE");
  });

  it("tarefa vencida para com alerta", () => {
    const step = decideCalendarDispatch(dispatchInput({ now: "2026-09-12T12:00:00.000Z" }));
    expect(step.kind).toBe("STOP");
    if (step.kind === "STOP") {
      expect(step.task.status).toBe("EXPIRED");
      expect(step.effects.map((effect) => effect.kind)).toEqual(["WRITE_AUDIT", "RAISE_ALERT"]);
    }
  });
});

describe("resultado do Google", () => {
  const running = () => transitionTask(scheduledTask(), "DISPATCHING", { at: ANCHOR });

  it("sucesso conclui com trilha e sem alerta", () => {
    const done = applyCalendarResult({ task: running(), result: { outcome: "SYNCED" }, now: ANCHOR });
    expect(done.task.status).toBe("SUCCEEDED");
    expect(done.effects.map((effect) => effect.kind)).toEqual(["WRITE_AUDIT"]);
    expect(done.effects[0].kind === "WRITE_AUDIT" && done.effects[0].audit.summary).toBe("Agenda Google atualizada.");
  });

  it("indisponibilidade tenta de novo e, esgotada, falha com alerta da agenda", () => {
    let task = running();
    for (let attempt = 1; attempt < RETRY_POLICY.maxAttempts; attempt += 1) {
      const retry = applyCalendarResult({
        task,
        result: { outcome: "TEMPORARY_FAILURE", failureCode: "PROVIDER_UNAVAILABLE" },
        now: ANCHOR,
      });
      expect(retry.task.status).toBe("SCHEDULED");
      expect(retry.requeueAt).not.toBeNull();
      task = transitionTask(retry.task, "DISPATCHING", { at: ANCHOR });
    }
    const failed = applyCalendarResult({
      task,
      result: { outcome: "TEMPORARY_FAILURE", failureCode: "PROVIDER_UNAVAILABLE" },
      now: ANCHOR,
    });
    expect(failed.task).toMatchObject({ status: "FAILED", failureCode: "ATTEMPTS_EXHAUSTED" });
    const alert = failed.effects.find((effect) => effect.kind === "RAISE_ALERT");
    expect(alert?.kind === "RAISE_ALERT" && alert.alert.title).toBe("Agenda Google não atualizada");
  });

  it("autorização revogada falha na hora e pede reconexão", () => {
    const failed = applyCalendarResult({
      task: running(),
      result: { outcome: "PERMANENT_FAILURE", failureCode: "CALENDAR_RECONNECT_REQUIRED" },
      now: ANCHOR,
    });
    expect(failed.task).toMatchObject({ status: "FAILED", attempt: 1, failureCode: "CALENDAR_RECONNECT_REQUIRED" });
    const alert = failed.effects.find((effect) => effect.kind === "RAISE_ALERT");
    expect(alert?.kind === "RAISE_ALERT" && alert.alert.body).toContain("Reconecte a agenda");
  });
});
