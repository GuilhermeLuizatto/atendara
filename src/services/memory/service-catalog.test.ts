import { describe, expect, it } from "vitest";

import { SERVICE_ERRORS } from "@/config/services";

import { MemoryWorkspaceRepository } from "./memory-repository";

/**
 * Catalogo de servicos (E2.1) no repositorio em memoria.
 *
 * O que importa aqui: a profissao sem a flag nem tem catalogo, e servico ja
 * usado em atendimento se arquiva em vez de sumir.
 */

function esteticista() {
  const repo = new MemoryWorkspaceRepository("AESTHETICS");
  repo.setActor({ userId: "u", name: "Teste", role: "OWNER" });
  return repo;
}

/**
 * Bem longe do conjunto gerado: a demonstracao povoa a agenda em volta de
 * hoje, e um horario proximo esbarraria num atendimento ficticio.
 */
const LONGE = new Date(Date.now() + 400 * 86_400_000).toISOString();

const NOVO = {
  name: "Limpeza de pele",
  description: null,
  durationMinutes: 60,
  priceInCents: 12000,
  enabled: true,
  returnIntervalDays: 30,
};

describe("catalogo de servicos", () => {
  it("a profissao sem a flag nao tem catalogo", () => {
    expect(new MemoryWorkspaceRepository("PSYCHOLOGIST").getSnapshot().services).toEqual([]);
  });

  it("a esteticista comeca com sugestoes sem preco e desligadas", () => {
    const services = esteticista().getSnapshot().services;

    expect(services.length).toBeGreaterThan(0);
    expect(services.every((service) => service.priceInCents === null)).toBe(true);
    expect(services.every((service) => service.enabled === false)).toBe(true);
  });

  it("cria servico no fim da lista e registra o valor na trilha", async () => {
    const repo = esteticista();
    const id = await repo.createService(NOVO);
    const snapshot = repo.getSnapshot();

    expect(snapshot.services.at(-1)?.id).toBe(id);
    expect(snapshot.services.at(-1)?.position).toBe(snapshot.services.length - 1);
    expect(snapshot.auditLogs[0].metadata).toMatchObject({ priceInCents: 12000, durationMinutes: 60 });
  });

  it("nao liga servico sem preco e sem duracao", async () => {
    const repo = esteticista();
    const rascunho = repo.getSnapshot().services[0];

    await expect(repo.updateService(rascunho.id, { enabled: true })).rejects.toThrow(
      SERVICE_ERRORS.ENABLED_NEEDS_PRICE_AND_DURATION,
    );
  });

  it("a alteracao guarda o preco anterior na trilha", async () => {
    const repo = esteticista();
    const id = await repo.createService(NOVO);
    await repo.updateService(id!, { priceInCents: 15000 });

    expect(repo.getSnapshot().auditLogs[0].metadata).toMatchObject({
      priceInCents: 15000,
      previousPriceInCents: 12000,
    });
  });

  it("apaga servico nunca usado", async () => {
    const repo = esteticista();
    const id = await repo.createService(NOVO);
    await repo.deleteService(id!);

    expect(repo.getSnapshot().services.some((service) => service.id === id)).toBe(false);
  });

  // Atendimento passado guarda o id: apagar deixaria um registro sem nome.
  it("recusa apagar servico ja usado e arquiva no lugar", async () => {
    const repo = esteticista();
    const id = await repo.createService(NOVO);
    const snapshot = repo.getSnapshot();
    await repo.createAppointment({
      clientId: snapshot.clients[0].id,
      professionalId: snapshot.professionals[0].id,
      startsAt: LONGE,
      durationMinutes: 60,
      serviceId: id,
      serviceName: NOVO.name,
      modality: snapshot.organization.settings.agenda.defaultModality ?? "IN_PERSON",
      status: "SCHEDULED",
      priceInCents: 12000,
      administrativeNotes: null,
    });

    await expect(repo.deleteService(id!)).rejects.toThrow("Arquive em vez de apagar");

    await repo.archiveService(id!);
    const arquivado = repo.getSnapshot().services.find((service) => service.id === id);
    expect(arquivado?.archivedAt).not.toBeNull();
    expect(arquivado?.enabled).toBe(false);
  });

  it("o atendimento guarda o nome do servico no momento em que aconteceu", async () => {
    const repo = esteticista();
    const id = await repo.createService(NOVO);
    const snapshot = repo.getSnapshot();
    const appointmentId = await repo.createAppointment({
      clientId: snapshot.clients[0].id,
      professionalId: snapshot.professionals[0].id,
      startsAt: LONGE,
      durationMinutes: 60,
      serviceId: id,
      serviceName: NOVO.name,
      modality: snapshot.organization.settings.agenda.defaultModality ?? "IN_PERSON",
      status: "SCHEDULED",
      priceInCents: 12000,
      administrativeNotes: null,
    });

    await repo.updateService(id!, { name: "Limpeza de pele profunda" });

    const appointment = repo.getSnapshot().appointments.find((item) => item.id === appointmentId);
    expect(appointment?.serviceName).toBe("Limpeza de pele");
  });

  it("quem nao gerencia servico nao cria", async () => {
    const repo = new MemoryWorkspaceRepository("AESTHETICS");
    repo.setActor({ userId: "u", name: "Teste", role: "OWNER", permissions: [] });

    await expect(repo.createService(NOVO)).rejects.toThrow("Sem permissão");
  });
});
