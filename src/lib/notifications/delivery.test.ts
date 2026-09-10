import { describe, expect, it } from "vitest";

import { MAX_DELIVERY_DELAY_MINUTES, RETRY_POLICY } from "@/config/notifications";

import { applyAttempt, deliveryKey, isDue, isExpired } from "./delivery";
import { dispatchDelivery, emptySummary, tally } from "./dispatch";
import { ANCHOR, delivery } from "./fixtures";
import { hashBody } from "./templates";
import { SIMULATED_DESTINATIONS } from "./providers";

const BODY = "Lembrete do seu treino em 11/09/2026 as 21:00.";

function planned(overrides: Parameters<typeof delivery>[0] = {}) {
  return delivery({ bodyHash: hashBody(BODY), bodyLength: BODY.length, ...overrides });
}

describe("deliveryKey", () => {
  it("e derivada do envio, entao repetir o planejamento da a mesma chave", () => {
    const base = {
      appointmentId: "atendimento-1",
      event: "APPOINTMENT_REMINDER" as const,
      channel: "SMS" as const,
      scheduledFor: "2026-09-10T23:00:00.000Z",
    };

    expect(deliveryKey(base)).toBe(deliveryKey(base));
    // Segundos diferentes, mesmo minuto: continua sendo o mesmo aviso.
    expect(deliveryKey({ ...base, scheduledFor: "2026-09-10T23:00:45.000Z" })).toBe(
      deliveryKey(base),
    );
  });

  it("muda quando muda o canal, o evento ou o horario", () => {
    const base = {
      appointmentId: "atendimento-1",
      event: "APPOINTMENT_REMINDER" as const,
      channel: "SMS" as const,
      scheduledFor: "2026-09-10T23:00:00.000Z",
    };

    expect(deliveryKey({ ...base, channel: "EMAIL" })).not.toBe(deliveryKey(base));
    expect(deliveryKey({ ...base, event: "APPOINTMENT_CANCELLED" })).not.toBe(
      deliveryKey(base),
    );
    expect(deliveryKey({ ...base, scheduledFor: "2026-09-10T22:00:00.000Z" })).not.toBe(
      deliveryKey(base),
    );
  });
});

describe("quando uma entrega vence", () => {
  it("so e devida a partir do horario planejado", () => {
    const item = planned({ scheduledFor: "2026-09-10T12:00:00.000Z" });
    expect(isDue(item, "2026-09-10T11:59:00.000Z")).toBe(false);
    expect(isDue(item, "2026-09-10T12:00:00.000Z")).toBe(true);
  });

  it("a espera entre tentativas adia o vencimento", () => {
    const item = planned({
      scheduledFor: "2026-09-10T12:00:00.000Z",
      nextAttemptAt: "2026-09-10T12:30:00.000Z",
    });
    expect(isDue(item, "2026-09-10T12:10:00.000Z")).toBe(false);
    expect(isDue(item, "2026-09-10T12:30:00.000Z")).toBe(true);
  });

  it("expira quando o atraso passa da janela util", () => {
    const item = planned({ scheduledFor: "2026-09-10T12:00:00.000Z" });
    const dentro = new Date(
      Date.parse(item.scheduledFor) + (MAX_DELIVERY_DELAY_MINUTES - 1) * 60_000,
    ).toISOString();
    const fora = new Date(
      Date.parse(item.scheduledFor) + (MAX_DELIVERY_DELAY_MINUTES + 1) * 60_000,
    ).toISOString();

    expect(isExpired(item, dentro)).toBe(false);
    expect(isExpired(item, fora)).toBe(true);
  });
});

describe("tentativas controladas", () => {
  it("aceito encerra em SENT, sem nova tentativa", () => {
    const transition = applyAttempt(
      planned(),
      { outcome: "ACCEPTED", providerMessageId: "sim_1", failureCode: null },
      ANCHOR,
    );

    expect(transition).toMatchObject({
      status: "SENT",
      attempts: 1,
      nextAttemptAt: null,
      sentAt: ANCHOR,
      failureCode: null,
    });
  });

  it("recusa definitiva nao ganha nova tentativa", () => {
    const transition = applyAttempt(
      planned(),
      {
        outcome: "REJECTED",
        providerMessageId: null,
        failureCode: "INVALID_DESTINATION",
      },
      ANCHOR,
    );

    expect(transition).toMatchObject({
      status: "FAILED",
      attempts: 1,
      nextAttemptAt: null,
      failureCode: "INVALID_DESTINATION",
    });
  });

  it("falha temporaria volta para PLANNED com espera crescente", () => {
    const first = applyAttempt(
      planned(),
      {
        outcome: "TEMPORARY_FAILURE",
        providerMessageId: null,
        failureCode: "PROVIDER_UNAVAILABLE",
      },
      ANCHOR,
    );
    const second = applyAttempt(
      planned({ attempts: first.attempts }),
      {
        outcome: "TEMPORARY_FAILURE",
        providerMessageId: null,
        failureCode: "PROVIDER_UNAVAILABLE",
      },
      ANCHOR,
    );

    expect(first.status).toBe("PLANNED");
    expect(second.status).toBe("PLANNED");
    expect(first.nextAttemptAt).toBe("2026-09-10T12:05:00.000Z");
    expect(second.nextAttemptAt).toBe("2026-09-10T12:30:00.000Z");
  });

  it("esgotadas as tentativas, para de tentar", () => {
    const transition = applyAttempt(
      planned({ attempts: RETRY_POLICY.maxAttempts - 1 }),
      {
        outcome: "TEMPORARY_FAILURE",
        providerMessageId: null,
        failureCode: "PROVIDER_UNAVAILABLE",
      },
      ANCHOR,
    );

    expect(transition).toMatchObject({
      status: "FAILED",
      attempts: RETRY_POLICY.maxAttempts,
      nextAttemptAt: null,
      failureCode: "ATTEMPTS_EXHAUSTED",
    });
  });
});

describe("dispatchDelivery com o provedor simulado", () => {
  const target = (overrides: Partial<Parameters<typeof dispatchDelivery>[0]> = {}) => ({
    delivery: planned(),
    destination: "+5500900000000",
    body: BODY,
    ...overrides,
  });

  it("envia e devolve o protocolo do provedor", async () => {
    const decision = await dispatchDelivery(target(), ANCHOR);

    expect(decision.action).toBe("SENT");
    if (decision.action !== "SENT") return;
    expect(decision.transition.providerMessageId).toMatch(/^sim_/);
  });

  it("o protocolo simulado e estavel para o mesmo pedido", async () => {
    const first = await dispatchDelivery(target(), ANCHOR);
    const second = await dispatchDelivery(target(), ANCHOR);

    expect(first).toEqual(second);
  });

  it("destino ficticio invalido termina em falha definitiva", async () => {
    const decision = await dispatchDelivery(
      target({ destination: SIMULATED_DESTINATIONS.invalid[0] }),
      ANCHOR,
    );

    expect(decision.action).toBe("FAILED");
    if (decision.action !== "FAILED") return;
    expect(decision.transition.failureCode).toBe("INVALID_DESTINATION");
  });

  it("destino ficticio instavel falha na primeira e e aceito na segunda", async () => {
    const destination = SIMULATED_DESTINATIONS.recoversOnRetry[0];
    const first = await dispatchDelivery(target({ destination }), ANCHOR);
    expect(first.action).toBe("RETRY");

    const second = await dispatchDelivery(
      target({ destination, delivery: planned({ attempts: 1 }) }),
      ANCHOR,
    );
    expect(second.action).toBe("SENT");
  });

  it("nao envia antes da hora", async () => {
    const decision = await dispatchDelivery(
      target({ delivery: planned({ scheduledFor: "2026-09-10T13:00:00.000Z" }) }),
      ANCHOR,
    );

    expect(decision).toEqual({ action: "SKIPPED", reason: "NOT_DUE" });
  });

  it("cancela em vez de enviar quando o destino deixou de existir", async () => {
    const decision = await dispatchDelivery(target({ destination: null }), ANCHOR);

    expect(decision).toEqual({
      action: "CANCELLED",
      reason: "NO_LONGER_ELIGIBLE",
    });
  });

  it("cancela quando o texto mudou depois do planejamento", async () => {
    // O registro guarda o hash justamente para isto: o que sai tem de ser o que
    // foi aprovado, e nao o que o modelo virou no meio do caminho.
    const decision = await dispatchDelivery(
      target({ body: "Outro texto qualquer." }),
      ANCHOR,
    );

    expect(decision).toEqual({ action: "CANCELLED", reason: "BODY_CHANGED" });
  });

  it("cancela quando o atraso passou da janela util", async () => {
    const decision = await dispatchDelivery(
      target(),
      "2026-09-10T20:00:00.000Z",
    );

    expect(decision).toEqual({ action: "CANCELLED", reason: "EXPIRED" });
  });
});

describe("resumo do disparo", () => {
  it("conta cada desfecho e ignora o que nao foi tentado", () => {
    let summary = emptySummary();
    summary = tally(summary, "a", {
      action: "SENT",
      transition: applyAttempt(
        planned(),
        { outcome: "ACCEPTED", providerMessageId: "sim_1", failureCode: null },
        ANCHOR,
      ),
    });
    summary = tally(summary, "b", { action: "SKIPPED", reason: "NOT_DUE" });
    summary = tally(summary, "c", { action: "CANCELLED", reason: "EXPIRED" });

    expect(summary).toEqual({
      sent: 1,
      retrying: 0,
      failed: 0,
      cancelled: 1,
      skipped: 1,
      touched: ["a", "c"],
    });
  });
});
