import { describe, expect, it } from "vitest";

import { partOf } from "@/lib/agenda/deposit";
import type { Transaction } from "@/types";

import { MemoryWorkspaceRepository } from "./memory-repository";

/**
 * Sinal antecipado (E2.2) de ponta a ponta no repositorio em memoria.
 *
 * O que importa aqui e o dinheiro: dois lancamentos que somam o valor cobrado,
 * e o destino do sinal quando o atendimento nao acontece.
 */

/** Longe do conjunto gerado, que povoa a agenda em volta de hoje. */
const LONGE = new Date(Date.now() + 400 * 86_400_000).toISOString();

function esteticista() {
  const repo = new MemoryWorkspaceRepository("AESTHETICS");
  repo.setActor({ userId: "u", name: "Teste", role: "OWNER" });
  return repo;
}

async function comSinal(repo: MemoryWorkspaceRepository, depositInCents: number | null) {
  const snapshot = repo.getSnapshot();
  const id = await repo.createAppointment({
    clientId: snapshot.clients[0].id,
    professionalId: snapshot.professionals[0].id,
    startsAt: LONGE,
    durationMinutes: 60,
    modality: "IN_PERSON",
    status: "SCHEDULED",
    priceInCents: 20000,
    depositInCents,
    administrativeNotes: null,
  });
  return id!;
}

function ligados(repo: MemoryWorkspaceRepository, id: string) {
  const todos = repo.getSnapshot().transactions.filter((item) => item.appointmentId === id);
  return {
    servico: todos.find((item) => partOf(item) === "SERVICE"),
    sinal: todos.find((item) => partOf(item) === "DEPOSIT"),
  };
}

/** Marca o sinal como pago, como ela faria pelo financeiro. */
async function pagarSinal(repo: MemoryWorkspaceRepository, id: string) {
  const sinal = ligados(repo, id).sinal as Transaction;
  await repo.updateTransaction(sinal.id, { status: "PAID" });
}

describe("sinal antecipado", () => {
  it("a profissao sem sinal recusa o valor", async () => {
    const repo = new MemoryWorkspaceRepository("PSYCHOLOGIST");
    repo.setActor({ userId: "u", name: "Teste", role: "OWNER" });
    const snapshot = repo.getSnapshot();

    await expect(
      repo.createAppointment({
        clientId: snapshot.clients[0].id,
        professionalId: snapshot.professionals[0].id,
        startsAt: LONGE,
        durationMinutes: 50,
        modality: "ONLINE",
        status: "SCHEDULED",
        priceInCents: 20000,
        depositInCents: 5000,
        administrativeNotes: null,
      }),
    ).rejects.toThrow("não trabalha com sinal");
  });

  // O sinal abate: os dois lancamentos somam o valor cobrado, nunca mais.
  it("R$ 200 com sinal de R$ 50 vira sinal de 5000 e servico de 15000", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, 5000);
    const { servico, sinal } = ligados(repo, id);

    expect(sinal?.amountInCents).toBe(5000);
    expect(servico?.amountInCents).toBe(15000);
    expect((sinal?.amountInCents ?? 0) + (servico?.amountInCents ?? 0)).toBe(20000);
    expect(sinal?.description).toContain("Sinal");
  });

  it("sem sinal continua com um lancamento so, pelo valor cheio", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, null);
    const { servico, sinal } = ligados(repo, id);

    expect(sinal).toBeUndefined();
    expect(servico?.amountInCents).toBe(20000);
  });

  it("sinal do valor inteiro nao deixa lancamento de servico", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, 20000);
    const { servico, sinal } = ligados(repo, id);

    expect(sinal?.amountInCents).toBe(20000);
    expect(servico).toBeUndefined();
  });

  it("recusa sinal maior que o valor do atendimento", async () => {
    const repo = esteticista();
    await expect(comSinal(repo, 25000)).rejects.toThrow("não pode passar do valor");
  });

  it("o sinal vence na marcacao, e o servico no atendimento", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, 5000);
    const { servico, sinal } = ligados(repo, id);

    expect(sinal?.dueDate).not.toBe(LONGE);
    expect(servico?.dueDate).toBe(LONGE);
  });
});

describe("o atendimento que nao acontece", () => {
  it("cancelar retem o sinal pago por padrao e derruba o que ficou a pagar", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, 5000);
    await pagarSinal(repo, id);

    await repo.setAppointmentStatus(id, "CANCELLED");

    const { servico, sinal } = ligados(repo, id);
    expect(sinal?.status).toBe("PAID");
    expect(servico?.status).toBe("CANCELLED");
    expect(repo.getSnapshot().appointments.find((item) => item.id === id)?.depositOutcome).toBe("KEPT");
    expect(repo.getSnapshot().auditLogs[0].metadata).toMatchObject({ deposit: "KEPT" });
  });

  it("cancelar devolvendo vira devolucao, e a trilha diz isso", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, 5000);
    await pagarSinal(repo, id);

    await repo.setAppointmentStatus(id, "CANCELLED", undefined, { deposit: "REFUND" });

    expect(ligados(repo, id).sinal?.status).toBe("REFUNDED");
    expect(repo.getSnapshot().appointments.find((item) => item.id === id)?.depositOutcome).toBe("REFUNDED");
    expect(repo.getSnapshot().auditLogs[0].metadata).toMatchObject({ deposit: "REFUNDED" });
  });

  // Nao ha o que reter de um sinal que nunca foi pago.
  it("cancelar com sinal nao pago derruba as duas cobrancas", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, 5000);

    await repo.setAppointmentStatus(id, "CANCELLED", undefined, { deposit: "KEEP" });

    const { servico, sinal } = ligados(repo, id);
    expect(sinal?.status).toBe("CANCELLED");
    expect(servico?.status).toBe("CANCELLED");
    expect(repo.getSnapshot().appointments.find((item) => item.id === id)?.depositOutcome).toBeNull();
  });

  it("falta sem aviso retem o sinal e derruba o resto, sem perguntar", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, 5000);
    await pagarSinal(repo, id);

    await repo.setAppointmentStatus(id, "NO_SHOW");

    const { servico, sinal } = ligados(repo, id);
    expect(sinal?.status).toBe("PAID");
    expect(servico?.status).toBe("CANCELLED");
    expect(repo.getSnapshot().appointments.find((item) => item.id === id)?.depositOutcome).toBe("KEPT");
  });

  // Sem sinal, a falta continua como era antes da E2.2: a cobranca fica de pe.
  it("falta sem aviso e sem sinal nao mexe na cobranca", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, null);

    await repo.setAppointmentStatus(id, "NO_SHOW");

    expect(ligados(repo, id).servico?.status).toBe("PENDING");
  });
});

describe("mudar o sinal depois", () => {
  it("aumentar o sinal acerta os dois lancamentos", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, 5000);

    await repo.updateAppointment(id, { depositInCents: 8000 });

    const { servico, sinal } = ligados(repo, id);
    expect(sinal?.amountInCents).toBe(8000);
    expect(servico?.amountInCents).toBe(12000);
  });

  it("pedir sinal depois da marcacao cria a cobranca do sinal", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, null);

    await repo.updateAppointment(id, { depositInCents: 6000 });

    const { servico, sinal } = ligados(repo, id);
    expect(sinal?.amountInCents).toBe(6000);
    expect(servico?.amountInCents).toBe(14000);
  });

  it("tirar o sinal cancela a cobranca dele e devolve o valor cheio ao servico", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, 5000);

    await repo.updateAppointment(id, { depositInCents: null });

    const { servico, sinal } = ligados(repo, id);
    expect(sinal?.status).toBe("CANCELLED");
    expect(servico?.amountInCents).toBe(20000);
  });

  // Mexer no valor de um sinal ja pago esconderia dinheiro que ja entrou.
  it("recusa mudar o sinal depois de pago", async () => {
    const repo = esteticista();
    const id = await comSinal(repo, 5000);
    await pagarSinal(repo, id);

    await expect(repo.updateAppointment(id, { depositInCents: 9000 })).rejects.toThrow(
      "sinal já foi pago",
    );
  });
});
