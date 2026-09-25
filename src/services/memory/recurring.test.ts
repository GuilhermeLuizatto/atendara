import { describe, expect, it } from "vitest";

import { periodOf } from "@/lib/finance/recurring";

import { MemoryWorkspaceRepository } from "./memory-repository";

/**
 * Mensalidades na demonstração: mesma regra do Firestore — lança o mês com o
 * marcador, retomar não duplica, encerrada não muda e cadastro com
 * mensalidade aberta não sai.
 */

function repositoryAs(role: "OWNER" | "ASSISTANT" | "VIEWER") {
  const repo = new MemoryWorkspaceRepository("PSYCHOLOGIST");
  repo.setActor({ userId: "u", name: "Teste", role });
  return repo;
}

function input(repo: MemoryWorkspaceRepository) {
  return {
    clientId: repo.getSnapshot().clients[0].id,
    professionalId: null,
    description: "Acompanhamento mensal",
    amountInCents: 45000,
    method: "PIX" as const,
    dueDay: 10,
    startPeriod: periodOf(new Date()),
  };
}

describe("mensalidades na demonstração", () => {
  it("cria, lança o mês corrente uma vez só e registra na trilha", async () => {
    const repo = repositoryAs("OWNER");
    const id = await repo.createRecurringCharge(input(repo));
    const period = periodOf(new Date());
    const snapshot = repo.getSnapshot();

    expect(snapshot.recurringCharges?.[0]).toMatchObject({ id, status: "ACTIVE", lastLaunchedPeriod: period });
    const launched = snapshot.transactions.filter((item) => item.recurringChargeId === id);
    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatchObject({ period, amountInCents: 45000 });
    // Depois do dia 10 o mes ja nasce vencido: o atraso e o de qualquer lancamento.
    expect(["PENDING", "OVERDUE"]).toContain(launched[0].status);
    expect(snapshot.auditLogs[0]).toMatchObject({ resource: { type: "recurringCharge", id } });

    await repo.setRecurringChargeStatus(id, "PAUSED");
    await repo.setRecurringChargeStatus(id, "ACTIVE");
    expect(repo.getSnapshot().transactions.filter((item) => item.recurringChargeId === id)).toHaveLength(1);
  });

  it("a secretária cria, mas não pausa; o visualizador não cria", async () => {
    const assistant = repositoryAs("ASSISTANT");
    const id = await assistant.createRecurringCharge(input(assistant));
    await expect(assistant.setRecurringChargeStatus(id, "PAUSED")).rejects.toThrow();
    const viewer = repositoryAs("VIEWER");
    await expect(viewer.createRecurringCharge(input(viewer))).rejects.toThrow();
  });

  it("encerrada não volta, e o cadastro só sai depois de encerrar", async () => {
    const repo = repositoryAs("OWNER");
    const data = input(repo);
    const id = await repo.createRecurringCharge(data);
    await expect(repo.deleteClient(data.clientId)).rejects.toThrow();
    await repo.setRecurringChargeStatus(id, "ENDED");
    await expect(repo.setRecurringChargeStatus(id, "ACTIVE")).rejects.toThrow("encerrada");
    await expect(repo.updateRecurringCharge(id, { amountInCents: 1000 })).rejects.toThrow("encerrada");
  });
});
