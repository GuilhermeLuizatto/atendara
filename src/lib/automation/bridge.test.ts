import { describe, expect, it } from "vitest";

import type { AutomationTask, NotificationDelivery } from "@/types";

import {
  BRIDGE_SIGNATURE_WINDOW_SECONDS,
  bridgeTaskPayload,
  decideCallback,
  isWithinSignatureWindow,
  parseCallbackPayload,
  progressFields,
  signedMessage,
  type BridgeCallbackPayload,
} from "./bridge";
import { ANCHOR, plannedReminder } from "./fixtures";
import { transitionTask } from "./tasks";

/** Uma tarefa ja entregue ao executor, que e o unico estado que aceita retorno. */
function awaiting(): { task: AutomationTask; delivery: NotificationDelivery } {
  const planned = plannedReminder();
  const task = ["SCHEDULED", "DISPATCHING", "DISPATCHED"].reduce(
    (current, to) => transitionTask(current, to as AutomationTask["status"], { at: ANCHOR }),
    planned.task,
  );
  return { task, delivery: { ...planned.delivery, status: "SENDING" } };
}

const AWAITING = awaiting();
/** Antes do vencimento da tarefa, para o retorno ainda valer. */
const NOW = ANCHOR;

function task(patch: Partial<AutomationTask> = {}): AutomationTask {
  return { ...AWAITING.task, ...patch };
}

function delivery(id: string): NotificationDelivery {
  return { ...AWAITING.delivery, id };
}

function callback(patch: Partial<BridgeCallbackPayload> = {}): BridgeCallbackPayload {
  return {
    version: 1,
    taskId: task().id,
    organizationId: task().organizationId,
    attempt: 1,
    outcome: "ACCEPTED",
    providerMessageId: "wamid.abc",
    failureCode: null,
    ...patch,
  };
}

describe("a tarefa que vai para o n8n", () => {
  it("leva so o minimo do contrato: nada de nome, cadastro nem dado do atendimento", () => {
    const payload = bridgeTaskPayload({
      deliveryId: "entrega-1",
      channel: "WHATSAPP",
      destination: "+5513999990000",
      body: "Seu atendimento é amanhã às 10h.",
      attempt: 2,
      taskId: "tarefa-1",
      organizationId: "org-1",
      idempotencyKey: "chave-1",
      expiresAt: "2026-09-20T13:00:00.000Z",
      providerSenderId: "1236644296208358",
    });

    expect(Object.keys(payload).sort()).toEqual(
      ["attempt", "body", "channel", "deliveryId", "destination", "expiresAt", "idempotencyKey", "organizationId", "providerSenderId", "taskId", "version"],
    );
    expect(payload).toMatchObject({
      taskId: "tarefa-1",
      organizationId: "org-1",
      attempt: 2,
      idempotencyKey: "chave-1",
      providerSenderId: "1236644296208358",
    });
  });

  it("assina horario e corpo juntos: so um dos dois deixaria pedido antigo valer para sempre", () => {
    expect(signedMessage("2026-09-20T12:00:00.000Z", '{"a":1}')).toBe('2026-09-20T12:00:00.000Z.{"a":1}');
  });

  it("recusa horario fora da janela, dos dois lados do relogio", () => {
    const dentro = new Date(Date.parse(NOW) - (BRIDGE_SIGNATURE_WINDOW_SECONDS - 10) * 1000).toISOString();
    const antigo = new Date(Date.parse(NOW) - (BRIDGE_SIGNATURE_WINDOW_SECONDS + 10) * 1000).toISOString();
    const futuro = new Date(Date.parse(NOW) + (BRIDGE_SIGNATURE_WINDOW_SECONDS + 10) * 1000).toISOString();

    expect(isWithinSignatureWindow(dentro, NOW)).toBe(true);
    expect(isWithinSignatureWindow(antigo, NOW)).toBe(false);
    expect(isWithinSignatureWindow(futuro, NOW)).toBe(false);
    expect(isWithinSignatureWindow("ontem", NOW)).toBe(false);
  });
});

describe("o formato do retorno", () => {
  it("aceita o contrato completo", () => {
    expect(parseCallbackPayload({ ...callback() })).toMatchObject({ outcome: "ACCEPTED", providerMessageId: "wamid.abc" });
  });

  it("recusa versao, campo faltando, tipo errado e codigo de falha inventado", () => {
    expect(parseCallbackPayload({ ...callback(), version: 2 })).toBeNull();
    expect(parseCallbackPayload({ ...callback(), taskId: "" })).toBeNull();
    expect(parseCallbackPayload({ ...callback(), attempt: 1.5 })).toBeNull();
    expect(parseCallbackPayload({ ...callback(), outcome: "ENTREGUE" })).toBeNull();
    expect(parseCallbackPayload({ ...callback(), outcome: "REJECTED", failureCode: "NUMERO_FEIO" })).toBeNull();
    expect(parseCallbackPayload("{}")).toBeNull();
    expect(parseCallbackPayload(null)).toBeNull();
  });

  it("exige coerencia entre resultado e codigo de falha", () => {
    expect(parseCallbackPayload({ ...callback(), failureCode: "RATE_LIMITED" })).toBeNull();
    expect(parseCallbackPayload({ ...callback(), outcome: "TEMPORARY_FAILURE", failureCode: null })).toBeNull();
    expect(parseCallbackPayload({ ...callback(), outcome: "TEMPORARY_FAILURE", providerMessageId: null, failureCode: "RATE_LIMITED" })).toMatchObject({
      outcome: "TEMPORARY_FAILURE",
    });
  });
});

describe("quem pode aplicar o retorno", () => {
  it("aplica quando a tarefa esta esperando o resultado daquela tentativa", () => {
    const esperando = task();
    const decision = decideCallback({ payload: callback(), task: esperando, delivery: delivery(esperando.deliveryId!), now: NOW });
    expect(decision.kind).toBe("APPLY");
  });

  it("recusa organizacao diferente da tarefa — o vazamento entre clinicas comecaria aqui", () => {
    const decision = decideCallback({
      payload: callback({ organizationId: "outra-org" }),
      task: task(),
      delivery: delivery(task().deliveryId!),
      now: NOW,
    });
    expect(decision).toEqual({ kind: "REJECT", why: "WRONG_ORGANIZATION" });
  });

  it("recusa tarefa que nao esta esperando resultado", () => {
    for (const status of ["PLANNED", "SCHEDULED", "DISPATCHING"] as const) {
      expect(decideCallback({ payload: callback(), task: task({ status }), delivery: delivery("x"), now: NOW })).toEqual({
        kind: "REJECT",
        why: "NOT_AWAITING",
      });
    }
  });

  it("ignora repeticao do mesmo retorno e retorno de tentativa velha", () => {
    const concluida = task({ status: "SUCCEEDED" });
    expect(decideCallback({ payload: callback(), task: concluida, delivery: delivery("x"), now: NOW })).toEqual({
      kind: "IGNORE",
      why: "ALREADY_APPLIED",
    });
    expect(decideCallback({ payload: callback({ attempt: 1 }), task: task({ attempt: 2 }), delivery: delivery("x"), now: NOW })).toEqual({
      kind: "IGNORE",
      why: "STALE_ATTEMPT",
    });
  });

  it("recusa tarefa vencida: lembrete que chega depois da hora nao lembra nada", () => {
    const vencida = task();
    expect(
      decideCallback({ payload: callback(), task: vencida, delivery: delivery(vencida.deliveryId!), now: vencida.expiresAt }),
    ).toEqual({ kind: "REJECT", why: "TASK_EXPIRED" });
  });

  it("recusa tarefa inexistente e entrega que nao e a da tarefa", () => {
    expect(decideCallback({ payload: callback(), task: null, delivery: null, now: NOW })).toEqual({ kind: "REJECT", why: "NOT_FOUND" });
    expect(decideCallback({ payload: callback(), task: task(), delivery: delivery("outra-entrega"), now: NOW })).toEqual({
      kind: "REJECT",
      why: "DELIVERY_NOT_FOUND",
    });
  });
});

describe("progresso do canal real (13.4)", () => {
  it("entregue e lida nao sao resultado: chegam com a tarefa ja concluida", () => {
    const concluida = task({ status: "SUCCEEDED" });
    const enviada = { ...delivery(concluida.deliveryId!), status: "SENT" as const };

    const decision = decideCallback({
      payload: callback({ progress: "DELIVERED" }),
      task: concluida,
      delivery: enviada,
      now: NOW,
    });

    expect(decision).toEqual({ kind: "PROGRESS", delivery: enviada, state: "DELIVERED" });
  });

  it("progresso de aviso que nao saiu e recusado", () => {
    const concluida = task({ status: "SUCCEEDED" });
    expect(
      decideCallback({
        payload: callback({ progress: "READ" }),
        task: concluida,
        delivery: { ...delivery(concluida.deliveryId!), status: "FAILED" },
        now: NOW,
      }),
    ).toEqual({ kind: "REJECT", why: "NOT_AWAITING" });
  });

  it("progresso com resultado que nao e aceite nao existe, e o formato recusa", () => {
    expect(parseCallbackPayload({ ...callback({ progress: "DELIVERED" }), outcome: "REJECTED", failureCode: "INVALID_DESTINATION", providerMessageId: null })).toBeNull();
    expect(parseCallbackPayload({ ...callback(), progress: "ENTREGUE" })).toBeNull();
    expect(parseCallbackPayload({ ...callback({ progress: "READ" }) })).toMatchObject({ progress: "READ" });
  });

  it("carimbo so na primeira vez: reentrega nao move horario ja registrado", () => {
    const enviada = { ...delivery("entrega-1"), status: "SENT" as const, sentAt: NOW };
    const depois = "2026-09-10T12:30:00.000Z";

    expect(progressFields(enviada, "DELIVERED", depois)).toEqual({ deliveredAt: depois });
    expect(progressFields({ ...enviada, deliveredAt: NOW }, "DELIVERED", depois)).toEqual({});
    // Lida implica entregue quando so o segundo aviso chegou.
    expect(progressFields(enviada, "READ", depois)).toEqual({ deliveredAt: depois, readAt: depois });
    expect(progressFields({ ...enviada, deliveredAt: NOW, readAt: NOW }, "READ", depois)).toEqual({});
  });
});
