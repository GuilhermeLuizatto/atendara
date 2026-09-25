import { describe, expect, it } from "vitest";

import type { RecurringCharge, Transaction } from "@/types";

import {
  chargeHistory,
  dueDateFor,
  monthlyTransaction,
  periodOf,
  recurringTransactionId,
  shiftPeriod,
  summarizeMonth,
  validateRecurringCharge,
} from "./recurring";

const NOW = "2026-09-25T15:00:00.000Z";

const charge = (patch: Partial<RecurringCharge> = {}): RecurringCharge => ({
  id: "m1",
  organizationId: "org",
  clientId: "c1",
  clientName: "Ana Ficticia",
  professionalId: "p1",
  description: "Mensalidade de acompanhamento",
  amountInCents: 45000,
  method: "PIX",
  dueDay: 10,
  startPeriod: "2026-09",
  lastLaunchedPeriod: null,
  status: "ACTIVE",
  endedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: "u",
  updatedBy: "u",
  ...patch,
});

const input = {
  clientId: "c1",
  professionalId: null,
  description: "  Mensalidade  ",
  amountInCents: 45000,
  method: "PIX" as const,
  dueDay: 10,
  startPeriod: "2026-09",
};

describe("mês e vencimento", () => {
  it("o mês é o do fuso do produto, não o UTC", () => {
    // 02:00 UTC do dia 1 ainda é dia 30 em São Paulo.
    expect(periodOf("2026-10-01T02:00:00.000Z")).toBe("2026-09");
    expect(periodOf("2026-10-01T04:00:00.000Z")).toBe("2026-10");
  });

  it("avança e volta meses atravessando o ano", () => {
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2027-01", -1)).toBe("2026-12");
    expect(shiftPeriod("2026-09", 0)).toBe("2026-09");
  });

  it("vencimento ao meio-dia do dia escolhido, no mês certo", () => {
    expect(periodOf(dueDateFor("2027-02", 28))).toBe("2027-02");
    expect(dueDateFor("2026-09", 5).startsWith("2026-09-05")).toBe(true);
  });
});

describe("validação", () => {
  it("aceita e apara a descrição", () => {
    expect(validateRecurringCharge(input)).toEqual({ ok: true, value: { ...input, description: "Mensalidade" } });
  });

  it.each([
    [{ clientId: "" }, "cadastro"],
    [{ description: "   " }, "Descreva"],
    [{ amountInCents: 0 }, "valor"],
    [{ amountInCents: 10.5 }, "valor"],
    [{ dueDay: 29 }, "dia 28"],
    [{ dueDay: 0 }, "dia 28"],
    [{ startPeriod: "2026-13" }, "mês de início"],
  ])("recusa %o", (patch, message) => {
    const result = validateRecurringCharge({ ...input, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});

describe("lançamento do mês", () => {
  it("nasce a receber, com id determinístico, valor em centavos e vínculo", () => {
    const transaction = monthlyTransaction(charge(), "2026-10", { now: NOW, userId: null })!;
    expect(transaction).toMatchObject({
      id: recurringTransactionId("m1", "2026-10"),
      type: "INCOME",
      status: "PENDING",
      amountInCents: 45000,
      recurringChargeId: "m1",
      period: "2026-10",
      clientId: "c1",
      paidAt: null,
    });
    expect(transaction.id).toBe("m1-202610");
    expect(transaction.description).toContain("outubro de 2026");
  });

  it("não lança mês pausado, encerrado ou anterior ao início", () => {
    const meta = { now: NOW, userId: null };
    expect(monthlyTransaction(charge({ status: "PAUSED" }), "2026-10", meta)).toBeNull();
    expect(monthlyTransaction(charge({ status: "ENDED" }), "2026-10", meta)).toBeNull();
    expect(monthlyTransaction(charge(), "2026-08", meta)).toBeNull();
  });
});

describe("painel do mês", () => {
  const tx = (id: string, patch: Partial<Transaction>): Transaction => ({
    ...monthlyTransaction(charge({ id }), "2026-09", { now: NOW, userId: null })!,
    ...patch,
  });

  it("soma previsto, recebido, pendente e atrasado só das mensalidades do mês", () => {
    const charges = [charge({ id: "a" }), charge({ id: "b" }), charge({ id: "c" }), charge({ id: "d", status: "PAUSED" })];
    const transactions = [
      tx("a", { status: "PAID", amountInCents: 10000 }),
      tx("b", { status: "PENDING", amountInCents: 20000 }),
      tx("c", { status: "OVERDUE", amountInCents: 30000 }),
      tx("x", { status: "CANCELLED", amountInCents: 99999 }),
      // Avulso e outro mês ficam de fora.
      { ...tx("y", { amountInCents: 77777 }), recurringChargeId: null },
      { ...tx("a", { amountInCents: 55555 }), period: "2026-08" },
    ];
    const month = summarizeMonth(charges, transactions, "2026-09");
    expect(month).toMatchObject({
      expectedInCents: 60000,
      receivedInCents: 10000,
      pendingInCents: 20000,
      overdueInCents: 30000,
      activeCharges: 3,
    });
    expect(month.collectionRate).toBeCloseTo(1 / 6);
    expect(month.rows.map((row) => [row.charge.id, row.transaction?.status ?? null])).toEqual([
      ["a", "PAID"],
      ["b", "PENDING"],
      ["c", "OVERDUE"],
      ["d", null],
    ]);
  });

  it("sem nada previsto, a taxa fica vazia; encerrada sem lançamento some do mês", () => {
    const month = summarizeMonth([charge({ status: "ENDED" }), charge({ id: "futura", startPeriod: "2026-12" })], [], "2026-09");
    expect(month.collectionRate).toBeNull();
    expect(month.rows).toEqual([]);
  });

  it("histórico do mais recente para o mais antigo", () => {
    const history = chargeHistory("m1", [
      { ...tx("m1", {}), period: "2026-07" },
      { ...tx("m1", {}), period: "2026-09" },
      { ...tx("outra", {}) },
    ]);
    expect(history.map((item) => item.period)).toEqual(["2026-09", "2026-07"]);
  });
});

describe("situação e lançamento imediato", () => {
  it("encerrada é terminal e repetir a situação é recusado", async () => {
    const { statusTransitionError } = await import("./recurring");
    expect(statusTransitionError("ENDED", "ACTIVE")).toContain("encerrada");
    expect(statusTransitionError("ACTIVE", "ACTIVE")).toContain("já está");
    expect(statusTransitionError("ACTIVE", "PAUSED")).toBeNull();
    expect(statusTransitionError("PAUSED", "ENDED")).toBeNull();
  });

  it("lança o mês corrente só se for posterior ao último lançado — mês apagado não renasce", async () => {
    const { currentMonthLaunch } = await import("./recurring");
    const meta = { now: NOW, userId: "u" };
    expect(currentMonthLaunch(charge(), meta)?.period).toBe("2026-09");
    expect(currentMonthLaunch(charge({ lastLaunchedPeriod: "2026-08" }), meta)?.period).toBe("2026-09");
    expect(currentMonthLaunch(charge({ lastLaunchedPeriod: "2026-09" }), meta)).toBeNull();
    expect(currentMonthLaunch(charge({ status: "PAUSED" }), meta)).toBeNull();
  });
});
