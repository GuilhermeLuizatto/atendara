import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryWorkspaceRepository } from "./memory-repository";

describe("fluxo financeiro no repositorio em memoria", () => {
  let repository: MemoryWorkspaceRepository;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T15:00:00Z"));
    repository = new MemoryWorkspaceRepository("PSYCHOLOGIST", new Date(), `finance-test-${crypto.randomUUID()}`);
    repository.setActor({ userId: "owner", name: "Titular", role: "OWNER" });
  });

  afterEach(() => vi.useRealTimers());

  it("cria, atualiza, paga e exclui um lancamento com trilha", async () => {
    const client = repository.getSnapshot().clients[0];
    const before = repository.getSnapshot().auditLogs.length;

    const id = await repository.createTransaction({
      type: "INCOME",
      clientId: client.id,
      professionalId: "prof-owner",
      appointmentId: null,
      description: "Avaliação inicial",
      amountInCents: 18000,
      status: "PENDING",
      method: "PIX",
      dueDate: "2026-09-10T12:00:00.000Z",
    });

    expect(repository.getSnapshot().transactions.find((item) => item.id === id)).toMatchObject({
      clientName: client.fullName,
      amountInCents: 18000,
      status: "PENDING",
    });

    await repository.updateTransaction(id, { status: "PAID", amountInCents: 20000 });
    expect(repository.getSnapshot().transactions.find((item) => item.id === id)).toMatchObject({
      amountInCents: 20000,
      status: "PAID",
    });

    await repository.deleteTransaction(id);
    expect(repository.getSnapshot().transactions.some((item) => item.id === id)).toBe(false);
    expect(repository.getSnapshot().auditLogs.filter((entry) => entry.resource.id === id)).toHaveLength(3);
    expect(repository.getSnapshot().auditLogs.length).toBe(before + 3);
  });
});
