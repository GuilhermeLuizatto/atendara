import { describe, expect, it } from "vitest";

import { getProfession } from "@/config/professions";
import { MAX_DELIVERY_DELAY_MINUTES, RETRY_POLICY } from "@/config/notifications";
import {
  FICTITIOUS,
  appointment,
  client,
  consent,
  consentAct,
  consentRecord,
  organization,
} from "@/lib/notifications/fixtures";
import { SIMULATED_DESTINATIONS, createSimulatedProvider } from "@/lib/notifications/providers";

import { completeDispatch, decideDispatch, type DispatchInput } from "./dispatch";
import { ANCHOR, PROFESSIONAL_NAME, REMINDER_AT, plannedReminder } from "./fixtures";
import { dispatchPayloadFor, newInternalTask, transitionTask } from "./tasks";

const provider = createSimulatedProvider();
const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

/** O lembrete das fixtures, ja na fila, no horario de sair. */
function dispatchInput(overrides: Partial<DispatchInput> = {}): DispatchInput {
  const { task, delivery } = plannedReminder();
  const scheduled = transitionTask(task, "SCHEDULED", { at: ANCHOR });
  const org = organization();
  const chosen = overrides.task ?? scheduled;
  return {
    payload: dispatchPayloadFor(chosen),
    task: scheduled,
    delivery,
    organization: org,
    profession: getProfession(org.primaryProfession),
    appointment: appointment(),
    client: client(),
    professionalName: PROFESSIONAL_NAME,
    now: REMINDER_AT,
    ...overrides,
  };
}

async function sendOnce(input: DispatchInput) {
  const step = decideDispatch(input);
  if (step.kind !== "SEND") throw new Error(`Esperava SEND, veio ${step.kind}.`);
  const result = await provider.send(step.request);
  return completeDispatch({ task: step.task, delivery: step.delivery, result, now: input.now });
}

describe("no horario", () => {
  it("adquire a tarefa e so o pedido ao provedor leva destino e texto", () => {
    const step = decideDispatch(dispatchInput());
    if (step.kind !== "SEND") throw new Error(step.kind);

    expect(step.task).toMatchObject({ status: "DISPATCHING", dispatchingSince: REMINDER_AT, attempt: 1 });
    expect(step.delivery.status).toBe("SENDING");
    expect(step.request).toMatchObject({ channel: "SMS", destination: FICTITIOUS.phone, attempt: 1 });
    expect(step.request.body).toContain("Alex");
    const stored = JSON.stringify([step.task, step.delivery]);
    expect(stored).not.toContain(FICTITIOUS.phone);
    expect(stored).not.toContain(step.request.body);
  });

  it("aceito vira SUCCEEDED, com a entrega enviada e a trilha no mesmo resultado", async () => {
    const done = await sendOnce(dispatchInput());

    expect(done.task.history.map((step) => step.to)).toEqual(["PLANNED", "SCHEDULED", "DISPATCHING", "DISPATCHED", "SUCCEEDED"]);
    expect(done.task.providerMessageId).toMatch(/^sim_/);
    expect(done.delivery).toMatchObject({ status: "SENT", attempts: 1, sentAt: REMINDER_AT });
    expect(done.requeueAt).toBeNull();
    expect(done.effects.map((effect) => effect.kind)).toEqual(["WRITE_AUDIT"]);
    const [audit] = done.effects;
    if (audit.kind !== "WRITE_AUDIT") throw new Error(audit.kind);
    expect(audit.task).toMatchObject({ type: "WRITE_AUDIT", status: "SUCCEEDED", sourceTaskId: done.task.id });
    expect(audit.audit).toMatchObject({
      actorType: "SYSTEM",
      actorId: null,
      resource: { type: "appointment", id: "atendimento-1" },
      summary: "Lembrete por SMS aceito pelo provedor simulado. Nenhuma mensagem real saiu.",
      metadata: { automationTaskId: done.task.id, status: "SUCCEEDED", attempt: 1 },
    });
  });
});

describe("reentrega", () => {
  it("o mesmo ponteiro depois de concluido nao faz nada", async () => {
    const done = await sendOnce(dispatchInput());
    expect(decideDispatch(dispatchInput({ task: done.task, delivery: done.delivery }))).toEqual({ kind: "IGNORE", why: "TERMINAL" });
  });

  it("com outra execucao em andamento, pede para a fila tentar depois", () => {
    const step = decideDispatch(dispatchInput());
    if (step.kind !== "SEND") throw new Error(step.kind);
    expect(decideDispatch(dispatchInput({ task: step.task, delivery: step.delivery, now: plus(REMINDER_AT, 1) }))).toEqual({
      kind: "BUSY",
    });
  });

  it("execucao interrompida passado o prazo falha, alerta e nao envia de novo", () => {
    const step = decideDispatch(dispatchInput());
    if (step.kind !== "SEND") throw new Error(step.kind);
    const later = decideDispatch(dispatchInput({ task: step.task, delivery: step.delivery, now: plus(REMINDER_AT, 10) }));

    expect(later.kind).toBe("STOP");
    if (later.kind !== "STOP") return;
    expect(later.task).toMatchObject({ status: "FAILED", failureCode: "DISPATCH_INTERRUPTED" });
    expect(later.delivery).toMatchObject({ status: "FAILED", failureCode: "DISPATCH_INTERRUPTED", nextAttemptAt: null });
    expect(later.effects.map((effect) => effect.kind)).toEqual(["WRITE_AUDIT", "RAISE_ALERT"]);
  });

  it("ponteiro de tentativa anterior: repoe a fila da corrente, ou ignora", async () => {
    const retrying = await sendOnce(dispatchInput({ client: client({ phone: SIMULATED_DESTINATIONS.alwaysUnavailable[0] }) }));
    expect(retrying.task).toMatchObject({ status: "SCHEDULED", attempt: 2 });

    const oldPointer = dispatchPayloadFor({ ...retrying.task, attempt: 1 });
    expect(decideDispatch(dispatchInput({ payload: oldPointer, task: retrying.task, delivery: retrying.delivery }))).toEqual({
      kind: "REQUEUE",
      task: retrying.task,
      at: retrying.task.scheduledFor,
    });
    expect(decideDispatch(dispatchInput({ payload: { ...oldPointer, attempt: 3 }, task: retrying.task }))).toEqual({
      kind: "IGNORE",
      why: "STALE_ATTEMPT",
    });
  });

  it("ponteiro de outra organizacao nao alcanca a tarefa", () => {
    const input = dispatchInput();
    expect(decideDispatch({ ...input, payload: { ...input.payload, organizationId: "org-vizinha" } })).toEqual({
      kind: "IGNORE",
      why: "NOT_FOUND",
    });
  });
});

describe("tarefa vencida e fora de hora", () => {
  it("vencida vira EXPIRED, cancela a entrega e alerta a equipe, sem chegar ao provedor", () => {
    const input = dispatchInput();
    const step = decideDispatch({ ...input, now: input.task!.expiresAt });

    expect(step.kind).toBe("STOP");
    if (step.kind !== "STOP") return;
    expect(step.task).toMatchObject({ status: "EXPIRED", stopReason: "TASK_EXPIRED" });
    expect(step.delivery).toMatchObject({ status: "CANCELLED" });
    expect(step.effects.map((effect) => effect.kind)).toEqual(["WRITE_AUDIT", "RAISE_ALERT"]);
    const alert = step.effects[1];
    if (alert.kind !== "RAISE_ALERT") throw new Error(alert.kind);
    expect(alert.alert).toMatchObject({
      type: "AUTOMATION_FAILURE",
      status: "UNREAD",
      channels: ["DASHBOARD"],
      target: { type: "appointment", id: "atendimento-1" },
    });
    expect(alert.alert.body).toContain("A tarefa venceu antes de ser executada.");
    expect(MAX_DELIVERY_DELAY_MINUTES).toBeGreaterThan(0);
  });

  it("antes da hora volta para a fila sem mudar de estado", () => {
    const input = dispatchInput({ now: plus(REMINDER_AT, -60) });
    expect(decideDispatch(input)).toEqual({ kind: "REQUEUE", task: input.task, at: REMINDER_AT });
  });
});

describe("as travas de novo, antes de enviar", () => {
  const cancelledBy = (overrides: Partial<DispatchInput>) => {
    const step = decideDispatch(dispatchInput(overrides));
    if (step.kind !== "STOP") throw new Error(`Esperava STOP, veio ${step.kind}.`);
    return step;
  };

  it("consentimento retirado entre planejar e enviar cancela, com trilha e sem alerta", () => {
    const withdrawn = client({
      notificationConsent: consent({ SMS: [consentRecord({ withdrawn: consentAct({ medium: "MESSAGE" }) })] }),
    });
    const step = cancelledBy({ client: withdrawn });

    expect(step.task).toMatchObject({ status: "CANCELLED", stopReason: "CONSENT_REVOKED" });
    expect(step.delivery).toMatchObject({ status: "CANCELLED", cancelledAt: REMINDER_AT });
    expect(step.effects.map((effect) => effect.kind)).toEqual(["WRITE_AUDIT"]);
    const [audit] = step.effects;
    if (audit.kind !== "WRITE_AUDIT") throw new Error(audit.kind);
    expect(audit.audit.summary).toBe("Lembrete por SMS cancelado antes do envio. O consentimento deste canal foi retirado.");
  });

  it("atendimento remarcado depois do planejamento cancela, mesmo antes de o gatilho rodar", () => {
    const step = cancelledBy({ appointment: appointment({ startsAt: "2026-09-11T03:00:00.000Z" }) });
    expect(step.task.stopReason).toBe("APPOINTMENT_RESCHEDULED");
  });

  it("atendimento cancelado, marcado como falta, ou de outro cadastro", () => {
    expect(cancelledBy({ appointment: appointment({ status: "CANCELLED" }) }).task.stopReason).toBe("APPOINTMENT_CANCELLED");
    expect(cancelledBy({ appointment: appointment({ status: "NO_SHOW" }) }).task.stopReason).toBe("APPOINTMENT_CANCELLED");
    expect(cancelledBy({ appointment: appointment({ clientId: "cliente-2" }) }).task.stopReason).toBe("APPOINTMENT_CLIENT_CHANGED");
    expect(cancelledBy({ appointment: null }).task.stopReason).toBe("APPOINTMENT_NOT_FOUND");
    expect(cancelledBy({ client: null }).task.stopReason).toBe("CLIENT_NOT_FOUND");
  });

  it("organizacao desligou os avisos, o canal ou a regra", () => {
    expect(cancelledBy({ organization: organization({ enabled: false }) }).task.stopReason).toBe("ORGANIZATION_DISABLED");
    expect(cancelledBy({ organization: organization({ verifiedSenderChannels: [] }) }).task.stopReason).toBe("SENDER_NOT_VERIFIED");
    expect(cancelledBy({ organization: organization({ rules: [] }) }).task.stopReason).toBe("RULE_NOT_FOUND");
    expect(cancelledBy({ organization: null, profession: null }).task.stopReason).toBe("ORGANIZATION_DISABLED");
  });

  it("texto diferente do planejado nao sai", () => {
    // O nome pelo qual a pessoa e chamada mudou depois do planejamento.
    expect(cancelledBy({ client: client({ preferredName: "Bia" }) }).task.stopReason).toBe("BODY_CHANGED");
  });

  it("contato trocado por um invalido nao sai", () => {
    expect(cancelledBy({ client: client({ phone: "12" }) }).task.stopReason).toBe("INVALID_CONTACT");
  });
});

describe("tentativas", () => {
  it("falha temporaria agenda a tentativa seguinte, e a terceira encerra com alerta", async () => {
    const unavailable = client({ phone: SIMULATED_DESTINATIONS.alwaysUnavailable[0] });
    const first = await sendOnce(dispatchInput({ client: unavailable }));
    expect(first.task).toMatchObject({ status: "SCHEDULED", attempt: 2, scheduledFor: plus(REMINDER_AT, 5), failureCode: "PROVIDER_UNAVAILABLE" });
    expect(first.delivery).toMatchObject({ status: "PLANNED", attempts: 1, nextAttemptAt: plus(REMINDER_AT, 5) });
    expect(first.requeueAt).toBe(plus(REMINDER_AT, 5));
    expect(first.effects.map((effect) => effect.kind)).toEqual(["WRITE_AUDIT"]);

    const next = (previous: typeof first) =>
      sendOnce(
        dispatchInput({
          client: unavailable,
          payload: dispatchPayloadFor(previous.task),
          task: previous.task,
          delivery: previous.delivery,
          now: previous.task.scheduledFor,
        }),
      );
    const second = await next(first);
    expect(second.task).toMatchObject({ status: "SCHEDULED", attempt: 3, scheduledFor: plus(REMINDER_AT, 35) });

    const last = await next(second);
    expect(last.task).toMatchObject({ status: "FAILED", attempt: RETRY_POLICY.maxAttempts, failureCode: "ATTEMPTS_EXHAUSTED" });
    expect(last.delivery).toMatchObject({ status: "FAILED", attempts: 3, nextAttemptAt: null });
    expect(last.effects.map((effect) => effect.kind)).toEqual(["WRITE_AUDIT", "RAISE_ALERT"]);
  });

  it("recusa definitiva nao ganha nova tentativa", async () => {
    const done = await sendOnce(dispatchInput({ client: client({ phone: SIMULATED_DESTINATIONS.invalid[0] }) }));
    expect(done.task).toMatchObject({ status: "FAILED", attempt: 1, failureCode: "INVALID_DESTINATION" });
    expect(done.requeueAt).toBeNull();
  });
});

describe("o que nunca sai do Atendara", () => {
  it("tarefa interna que chegue ao despachante e cancelada sem executar", () => {
    const { task } = plannedReminder();
    const alert = newInternalTask("RAISE_ALERT", task, ANCHOR);
    const step = decideDispatch(dispatchInput({ payload: dispatchPayloadFor(alert), task: alert, delivery: null }));
    expect(step.kind).toBe("STOP");
    if (step.kind !== "STOP") return;
    expect(step.task).toMatchObject({ status: "CANCELLED", stopReason: "NO_EXECUTOR" });
  });

  it("trilha e alerta nao levam nome, contato nem texto, e tem id deterministico", async () => {
    const unavailable = client({ phone: SIMULATED_DESTINATIONS.invalid[0] });
    const input = dispatchInput({ client: unavailable });
    const step = decideDispatch(input);
    if (step.kind !== "SEND") throw new Error(step.kind);
    const done = completeDispatch({ task: step.task, delivery: step.delivery, result: await provider.send(step.request), now: REMINDER_AT });
    const again = completeDispatch({ task: step.task, delivery: step.delivery, result: await provider.send(step.request), now: REMINDER_AT });

    const written = JSON.stringify(done.effects);
    for (const forbidden of ["Alex", SIMULATED_DESTINATIONS.invalid[0], step.request.body]) {
      expect(written).not.toContain(forbidden);
    }
    expect(done.effects.map((effect) => effect.task.id)).toEqual(again.effects.map((effect) => effect.task.id));
  });
});
