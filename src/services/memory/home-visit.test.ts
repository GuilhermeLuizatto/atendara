import { describe, expect, it } from "vitest";

import { partOf } from "@/lib/agenda/charges";

import { MemoryWorkspaceRepository } from "./memory-repository";

/**
 * Atendimento a domicílio (E2.3) no repositório em memória.
 *
 * Duas coisas importam: a taxa vira lançamento próprio, e o endereço fica
 * dentro do painel — não entra em aviso nem em tarefa de automação.
 */

const LONGE = new Date(Date.now() + 400 * 86_400_000).toISOString();
const ENDERECO = "Rua das Flores, 100, apto 2";

function esteticista() {
  const repo = new MemoryWorkspaceRepository("AESTHETICS");
  repo.setActor({ userId: "u", name: "Teste", role: "OWNER" });
  return repo;
}

async function domicilio(
  repo: MemoryWorkspaceRepository,
  patch: { visitAddress?: string | null; travelFeeInCents?: number | null } = {},
) {
  const snapshot = repo.getSnapshot();
  return (await repo.createAppointment({
    clientId: snapshot.clients[0].id,
    professionalId: snapshot.professionals[0].id,
    startsAt: LONGE,
    durationMinutes: 60,
    modality: "HOME_VISIT",
    status: "SCHEDULED",
    priceInCents: 20000,
    administrativeNotes: null,
    visitAddress: ENDERECO,
    travelFeeInCents: 3000,
    ...patch,
  }))!;
}

function ligados(repo: MemoryWorkspaceRepository, id: string) {
  const todos = repo.getSnapshot().transactions.filter((item) => item.appointmentId === id);
  return {
    servico: todos.find((item) => partOf(item) === "SERVICE"),
    deslocamento: todos.find((item) => partOf(item) === "TRAVEL"),
  };
}

describe("atendimento a domicilio", () => {
  it("a profissao sem domicilio recusa o endereco", async () => {
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
        administrativeNotes: null,
        visitAddress: ENDERECO,
        travelFeeInCents: null,
      }),
    ).rejects.toThrow("não registra endereço");
  });

  // A taxa e lancamento proprio (decisao do titular, 20/09): no fim do mes ela
  // enxerga quanto ganhou so indo ate a cliente.
  it("a taxa vira lancamento proprio, separada do trabalho", async () => {
    const repo = esteticista();
    const id = await domicilio(repo);
    const { servico, deslocamento } = ligados(repo, id);

    expect(servico?.amountInCents).toBe(20000);
    expect(deslocamento?.amountInCents).toBe(3000);
    expect(deslocamento?.description).toContain("Deslocamento");
  });

  it("domicilio sem taxa nao cria lancamento de deslocamento", async () => {
    const repo = esteticista();
    const id = await domicilio(repo, { travelFeeInCents: null });

    expect(ligados(repo, id).deslocamento).toBeUndefined();
    expect(repo.getSnapshot().appointments.find((item) => item.id === id)?.visitAddress).toBe(ENDERECO);
  });

  it("recusa endereco em atendimento presencial", async () => {
    const repo = esteticista();
    await expect(domicilio(repo, {})).resolves.toBeTruthy();

    const snapshot = repo.getSnapshot();
    await expect(
      repo.createAppointment({
        clientId: snapshot.clients[0].id,
        professionalId: snapshot.professionals[0].id,
        startsAt: new Date(Date.now() + 401 * 86_400_000).toISOString(),
        durationMinutes: 60,
        modality: "IN_PERSON",
        status: "SCHEDULED",
        priceInCents: 20000,
        administrativeNotes: null,
        visitAddress: ENDERECO,
        travelFeeInCents: null,
      }),
    ).rejects.toThrow("só é registrado em atendimento a domicílio");
  });

  it("mudar a taxa acerta o lancamento, e tirar a taxa cancela a cobranca", async () => {
    const repo = esteticista();
    const id = await domicilio(repo);

    await repo.updateAppointment(id, { travelFeeInCents: 4500 });
    expect(ligados(repo, id).deslocamento?.amountInCents).toBe(4500);

    await repo.updateAppointment(id, { travelFeeInCents: null });
    expect(ligados(repo, id).deslocamento?.status).toBe("CANCELLED");
  });

  it("pedir deslocamento depois cria a cobranca, sem mexer no trabalho", async () => {
    const repo = esteticista();
    const id = await domicilio(repo, { travelFeeInCents: null });

    await repo.updateAppointment(id, { travelFeeInCents: 2500 });

    const { servico, deslocamento } = ligados(repo, id);
    expect(deslocamento?.amountInCents).toBe(2500);
    expect(servico?.amountInCents).toBe(20000);
  });

  it("cancelar derruba trabalho e deslocamento juntos", async () => {
    const repo = esteticista();
    const id = await domicilio(repo);

    await repo.setAppointmentStatus(id, "CANCELLED");

    const { servico, deslocamento } = ligados(repo, id);
    expect(servico?.status).toBe("CANCELLED");
    expect(deslocamento?.status).toBe("CANCELLED");
  });
});

/**
 * O endereço é dado pessoal e fica no painel. Esta é a trava que impede um
 * refactor futuro de levá-lo para a fila — de onde ele sairia para a Meta.
 */
describe("o endereco nao sai do painel", () => {
  it("nenhuma entrega planejada nem tarefa carrega o endereco", async () => {
    const repo = esteticista();
    const id = await domicilio(repo);
    await repo.setAppointmentStatus(id, "CONFIRMED");

    const snapshot = repo.getSnapshot();
    const serializado = JSON.stringify({
      notificationDeliveries: snapshot.notificationDeliveries,
      notifications: snapshot.notifications,
      conversations: snapshot.conversations,
      messages: snapshot.messages,
    });

    expect(serializado).not.toContain(ENDERECO);
    expect(serializado).not.toContain("Rua das Flores");
  });

  it("a trilha do atendimento nao repete o endereco", async () => {
    const repo = esteticista();
    await domicilio(repo);

    expect(JSON.stringify(repo.getSnapshot().auditLogs)).not.toContain(ENDERECO);
  });
});
