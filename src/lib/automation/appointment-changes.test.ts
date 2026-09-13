import { describe, expect, it } from "vitest";

import {
  appointment,
  client,
  consent,
  consentRecord,
  organization,
  reminderRule,
} from "@/lib/notifications/fixtures";

import { appointmentNoticeEvents, planAppointmentChange } from "./appointment-changes";
import { ANCHOR, APPOINTMENT_START, REMINDER_AT, changeInput, confirmationRule, plannedReminder } from "./fixtures";
import { transitionTask } from "./tasks";

const MOVED_START = "2026-09-11T03:00:00.000Z";
const moved = () =>
  appointment({ startsAt: MOVED_START, endsAt: "2026-09-11T04:00:00.000Z", updatedAt: "2026-09-10T13:00:00.000Z" });

describe("eventos de uma escrita", () => {
  it("agendar, confirmar, remarcar, trocar o cadastro e cancelar", () => {
    const base = appointment();
    expect(appointmentNoticeEvents(null, base)).toEqual(["APPOINTMENT_SCHEDULED", "APPOINTMENT_REMINDER"]);
    expect(appointmentNoticeEvents(base, { ...base, status: "CONFIRMED" })).toEqual(["APPOINTMENT_CONFIRMED"]);
    expect(appointmentNoticeEvents(base, moved())).toEqual(["APPOINTMENT_REMINDER"]);
    expect(appointmentNoticeEvents(base, { ...base, clientId: "cliente-2" })).toEqual(["APPOINTMENT_REMINDER"]);
    expect(appointmentNoticeEvents(base, { ...base, status: "CANCELLED" })).toEqual(["APPOINTMENT_CANCELLED"]);
    expect(appointmentNoticeEvents(base, { ...base, administrativeNotes: "Trazer ficha." })).toEqual([]);
    expect(appointmentNoticeEvents(base, null)).toEqual([]);
  });
});

describe("planejamento no gatilho", () => {
  it("agendar planeja o lembrete; agendamento ainda nao tem tarefa e nao planeja nada", () => {
    const org = organization({
      rules: [reminderRule(), reminderRule({ id: "regra-agendamento", event: "APPOINTMENT_SCHEDULED", leadMinutes: 0 })],
    });
    const plan = planAppointmentChange(changeInput({ organization: org }));

    expect(plan.created.map(({ task }) => [task.type, task.scheduledFor])).toEqual([["SEND_REMINDER", REMINDER_AT]]);
    expect(plan.skipped).toContainEqual({ ruleId: "regra-agendamento", channel: "SMS", reason: "EVENT_WITHOUT_AUTOMATION" });
    expect(plan.stopped).toEqual([]);
  });

  it("organizacao sem avisos ligados nao grava nada", () => {
    const plan = planAppointmentChange(changeInput({ organization: organization({ enabled: false }) }));
    expect(plan).toMatchObject({ created: [], stopped: [], effects: [] });
  });

  it("reentrega do mesmo evento nao cria tarefa nem entrega", () => {
    const first = planAppointmentChange(changeInput());
    const again = planAppointmentChange(
      changeInput({
        tasks: first.created.map(({ task }) => task),
        deliveries: first.created.map(({ delivery }) => delivery),
      }),
    );
    expect(first.created).toHaveLength(1);
    expect(again).toMatchObject({ created: [], stopped: [], effects: [] });
    expect(again.skipped).toContainEqual({ ruleId: "regra-lembrete", channel: "SMS", reason: "ALREADY_PLANNED" });
  });

  it("confirmar planeja CONFIRM_APPOINTMENT so com regra de confirmacao, no instante da escrita", () => {
    const before = appointment();
    const confirmed = appointment({ status: "CONFIRMED" });
    const onlyReminder = planAppointmentChange(changeInput({ before, after: confirmed, current: confirmed }));
    expect(onlyReminder.created).toEqual([]);

    const org = organization({ rules: [reminderRule(), confirmationRule()] });
    const plan = planAppointmentChange(changeInput({ organization: org, before, after: confirmed, current: confirmed }));
    expect(plan.created.map(({ task }) => [task.type, task.scheduledFor])).toEqual([["CONFIRM_APPOINTMENT", ANCHOR]]);
  });

  it("confirmacao desfeita antes de o gatilho rodar nao vira aviso atrasado", () => {
    const org = organization({ rules: [confirmationRule()] });
    const plan = planAppointmentChange(
      changeInput({ organization: org, before: appointment(), after: appointment({ status: "CONFIRMED" }), current: appointment() }),
    );
    expect(plan.created).toEqual([]);
  });

  it("confirmacao com o atendimento ja comecado nao nasce vencida", () => {
    const org = organization({ rules: [confirmationRule()] });
    const confirmed = appointment({ status: "CONFIRMED" });
    const plan = planAppointmentChange(
      changeInput({
        organization: org,
        before: appointment(),
        after: confirmed,
        current: confirmed,
        changedAt: "2026-09-11T00:10:00.000Z",
      }),
    );
    expect(plan.created).toEqual([]);
    expect(plan.skipped).toContainEqual({ ruleId: "regra-confirmacao", channel: "SMS", reason: "SCHEDULE_IN_THE_PAST" });
  });

  it("remarcar cancela o lembrete que nao saiu, com trilha, e planeja o do novo horario", () => {
    const original = plannedReminder();
    const plan = planAppointmentChange(
      changeInput({
        before: appointment(),
        after: moved(),
        current: moved(),
        tasks: [original.task],
        deliveries: [original.delivery],
        changedAt: "2026-09-10T13:00:00.000Z",
      }),
    );

    expect(plan.stopped).toHaveLength(1);
    expect(plan.stopped[0].task).toMatchObject({ id: original.task.id, status: "CANCELLED", stopReason: "APPOINTMENT_RESCHEDULED" });
    expect(plan.stopped[0].delivery).toMatchObject({ status: "CANCELLED", cancelledAt: "2026-09-10T13:00:00.000Z" });
    expect(plan.effects.map((effect) => [effect.kind, effect.task.sourceTaskId])).toEqual([["WRITE_AUDIT", original.task.id]]);
    expect(plan.created.map(({ task }) => [task.scheduledFor, task.appointmentStartsAt])).toEqual([
      ["2026-09-11T02:00:00.000Z", MOVED_START],
    ]);
  });

  it("evento velho entregue depois nao cancela o lembrete que o evento novo planejou", () => {
    const original = plannedReminder();
    const afterMove = planAppointmentChange(
      changeInput({ before: appointment(), after: moved(), current: moved(), tasks: [original.task], deliveries: [original.delivery] }),
    );
    const tasks = [afterMove.stopped[0].task, ...afterMove.created.map(({ task }) => task)];
    const deliveries = [afterMove.stopped[0].delivery!, ...afterMove.created.map(({ delivery }) => delivery)];

    // O agendamento original chega de novo, com o atendimento ja remarcado.
    const stale = planAppointmentChange(changeInput({ before: null, after: appointment(), current: moved(), tasks, deliveries }));
    expect(stale).toMatchObject({ created: [], stopped: [], effects: [] });
  });

  it("remarcar de volta para o horario original planeja de novo, com sufixo, sem reabrir o cancelado", () => {
    const original = plannedReminder();
    const afterMove = planAppointmentChange(
      changeInput({ before: appointment(), after: moved(), current: moved(), tasks: [original.task], deliveries: [original.delivery] }),
    );
    const tasks = [afterMove.stopped[0].task, ...afterMove.created.map(({ task }) => task)];

    const back = planAppointmentChange(changeInput({ before: moved(), after: appointment(), current: appointment(), tasks }));
    expect(back.stopped.map(({ task }) => task.stopReason)).toEqual(["APPOINTMENT_RESCHEDULED"]);
    expect(back.created.map(({ task }) => task.id)).toEqual([`${original.task.id}_2`]);
    expect(back.created[0].task.idempotencyKey).toBe(original.task.id);
  });

  it("cancelar o atendimento cancela o que nao saiu e deixa o que ja saiu", () => {
    const pending = plannedReminder();
    const sent = { ...pending.task, id: "ja-enviado", deliveryId: "ja-enviado", status: "SUCCEEDED" as const };
    const cancelled = appointment({ status: "CANCELLED" });
    const plan = planAppointmentChange(
      changeInput({ before: appointment(), after: cancelled, current: cancelled, tasks: [pending.task, sent], deliveries: [pending.delivery] }),
    );
    expect(plan.stopped.map(({ task }) => [task.id, task.stopReason])).toEqual([[pending.task.id, "APPOINTMENT_CANCELLED"]]);
    expect(plan.created).toEqual([]);
  });

  it("passar o atendimento para outro cadastro cancela o aviso de quem saiu e planeja para quem entrou", () => {
    const original = plannedReminder();
    const other = client({ id: "cliente-2", notificationConsent: consent({ SMS: [consentRecord()] }) });
    const changed = appointment({ clientId: "cliente-2" });
    const plan = planAppointmentChange(
      changeInput({ before: appointment(), after: changed, current: changed, client: other, tasks: [original.task], deliveries: [original.delivery] }),
    );
    expect(plan.stopped.map(({ task }) => task.stopReason)).toEqual(["APPOINTMENT_CLIENT_CHANGED"]);
    expect(plan.created.map(({ task }) => task.clientId)).toEqual(["cliente-2"]);
  });

  it("tarefa ja adquirida pelo despachante nao e cancelada pela agenda", () => {
    const { task, delivery } = plannedReminder();
    const dispatching = transitionTask(transitionTask(task, "SCHEDULED", { at: ANCHOR }), "DISPATCHING", { at: REMINDER_AT });
    const cancelled = appointment({ status: "CANCELLED" });
    const plan = planAppointmentChange(
      changeInput({ before: appointment(), after: cancelled, current: cancelled, tasks: [dispatching], deliveries: [delivery] }),
    );
    expect(plan.stopped).toEqual([]);
  });

  it("organizacao em exclusao nao recebe escrita nenhuma, nem cancelamento", () => {
    const { task, delivery } = plannedReminder();
    const plan = planAppointmentChange(
      changeInput({ organization: null, current: null, after: null, before: appointment(), tasks: [task], deliveries: [delivery] }),
    );
    expect(plan).toMatchObject({ created: [], stopped: [], effects: [] });
    expect(APPOINTMENT_START).toBe(task.appointmentStartsAt);
  });
});
