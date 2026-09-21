import { describe, expect, it } from "vitest";

import type { Appointment, Service } from "@/types";

import { maintenanceSuggestions } from "./maintenance";

/**
 * O fuso importa aqui: "voltar em 30 dias" é uma data de calendário em São
 * Paulo, e o instante guardado é UTC. Atendimento às 22h de Brasília é 01h do
 * dia seguinte em UTC — se a conta usar o dia UTC, o retorno vence um dia
 * adiantado.
 */

const HOJE = new Date("2026-09-20T15:00:00.000Z");

function servico(patch: Partial<Service> = {}): Service {
  return {
    id: "servico-1",
    organizationId: "org-1",
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    name: "Manicure",
    description: null,
    durationMinutes: 45,
    priceInCents: 7000,
    enabled: true,
    returnIntervalDays: 30,
    position: 0,
    archivedAt: null,
    ...patch,
  };
}

function atendimento(patch: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    organizationId: "org-1",
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    clientId: "cliente-1",
    clientName: "Alex Fictício",
    professionalId: "prof-1",
    professionalName: "Sam Fictício",
    startsAt: "2026-08-01T13:00:00.000Z",
    endsAt: "2026-08-01T13:45:00.000Z",
    durationMinutes: 45,
    serviceId: "servico-1",
    serviceName: "Manicure",
    depositInCents: null,
    depositOutcome: null,
    visitAddress: null,
    travelFeeInCents: null,
    modality: "IN_PERSON",
    status: "COMPLETED",
    priceInCents: 7000,
    administrativeNotes: null,
    origin: "MANUAL",
    confirmedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    rescheduledFromId: null,
    externalCalendar: null,
    ...patch,
  };
}

describe("sugestao de retorno", () => {
  it("aponta quem passou do intervalo, com os dias de atraso", () => {
    const lista = maintenanceSuggestions({
      appointments: [atendimento()],
      services: [servico()],
      now: HOJE,
    });

    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      clientName: "Alex Fictício",
      serviceName: "Manicure",
      lastVisitOn: "2026-08-01",
      dueOn: "2026-08-31",
      daysLate: 20,
      status: "DUE",
    });
  });

  it("mostra o que esta perto de vencer, marcado como SOON", () => {
    const lista = maintenanceSuggestions({
      appointments: [atendimento({ startsAt: "2026-08-25T13:00:00.000Z" })],
      services: [servico()],
      now: HOJE,
    });

    expect(lista[0]).toMatchObject({ dueOn: "2026-09-24", daysLate: -4, status: "SOON" });
  });

  it("ignora o que vence depois do horizonte", () => {
    expect(
      maintenanceSuggestions({
        appointments: [atendimento({ startsAt: "2026-09-15T13:00:00.000Z" })],
        services: [servico()],
        now: HOJE,
      }),
    ).toEqual([]);
  });

  // Ela ja tem horario marcado: cobrar retorno seria cobrar quem ja voltou.
  it("tira da lista quem ja tem o proximo horario daquele servico", () => {
    const lista = maintenanceSuggestions({
      appointments: [
        atendimento(),
        atendimento({ id: "appt-2", startsAt: "2026-10-01T13:00:00.000Z", status: "SCHEDULED" }),
      ],
      services: [servico()],
      now: HOJE,
    });

    expect(lista).toEqual([]);
  });

  it("horario marcado de OUTRO servico nao tira a sugestao", () => {
    const lista = maintenanceSuggestions({
      appointments: [
        atendimento(),
        atendimento({ id: "appt-2", serviceId: "servico-2", startsAt: "2026-10-01T13:00:00.000Z", status: "SCHEDULED" }),
      ],
      services: [servico()],
      now: HOJE,
    });

    expect(lista).toHaveLength(1);
  });

  it("conta do ultimo atendimento realizado, nao do primeiro", () => {
    const lista = maintenanceSuggestions({
      appointments: [
        atendimento({ id: "antigo", startsAt: "2026-05-01T13:00:00.000Z" }),
        atendimento({ id: "recente", startsAt: "2026-08-10T13:00:00.000Z" }),
      ],
      services: [servico()],
      now: HOJE,
    });

    expect(lista[0]).toMatchObject({ lastVisitOn: "2026-08-10", dueOn: "2026-09-09" });
  });

  it("cancelado e falta nao contam como visita", () => {
    expect(
      maintenanceSuggestions({
        appointments: [
          atendimento({ status: "CANCELLED" }),
          atendimento({ id: "appt-2", status: "NO_SHOW" }),
        ],
        services: [servico()],
        now: HOJE,
      }),
    ).toEqual([]);
  });

  it("servico sem intervalo definido nao sugere nada", () => {
    expect(
      maintenanceSuggestions({
        appointments: [atendimento()],
        services: [servico({ returnIntervalDays: null })],
        now: HOJE,
      }),
    ).toEqual([]);
  });

  it("atendimento sem servico do catalogo fica de fora", () => {
    expect(
      maintenanceSuggestions({
        appointments: [atendimento({ serviceId: null, serviceName: null })],
        services: [servico()],
        now: HOJE,
      }),
    ).toEqual([]);
  });

  // 22h em Brasilia e 01h do dia seguinte em UTC: contar pelo dia UTC venceria
  // o retorno um dia adiantado.
  it("conta pelo dia de calendario do fuso do produto, e nao pelo dia UTC", () => {
    const lista = maintenanceSuggestions({
      appointments: [atendimento({ startsAt: "2026-08-22T01:00:00.000Z" })],
      services: [servico()],
      now: HOJE,
    });

    expect(lista[0]).toMatchObject({ lastVisitOn: "2026-08-21", dueOn: "2026-09-20", status: "DUE" });
  });

  it("a mais atrasada vem primeiro", () => {
    const lista = maintenanceSuggestions({
      appointments: [
        atendimento({ id: "a", clientId: "c-1", clientName: "Bruna", startsAt: "2026-08-10T13:00:00.000Z" }),
        atendimento({ id: "b", clientId: "c-2", clientName: "Ana", startsAt: "2026-07-01T13:00:00.000Z" }),
      ],
      services: [servico()],
      now: HOJE,
    });

    expect(lista.map((item) => item.clientName)).toEqual(["Ana", "Bruna"]);
  });

  it("o nome do servico vem do catalogo de hoje, nao do atendimento antigo", () => {
    const lista = maintenanceSuggestions({
      appointments: [atendimento({ serviceName: "Nome antigo" })],
      services: [servico({ name: "Manicure completa" })],
      now: HOJE,
    });

    expect(lista[0].serviceName).toBe("Manicure completa");
  });
});
