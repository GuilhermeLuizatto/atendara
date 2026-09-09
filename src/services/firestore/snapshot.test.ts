import { describe, expect, it } from "vitest";

import type { AIRule, Appointment, Client, Transaction } from "@/types";

import { assembleSnapshot, emptyParts, type SnapshotParts } from "./snapshot";

/**
 * A montagem do snapshot e onde duas garantias vivem: regra fundamental nao vem
 * do banco, e agregado derivado nao e verdade gravada.
 */

const ORG = "org-teste";
const NOW = "2026-09-09T15:00:00.000Z";

function parts(patch: Partial<SnapshotParts> = {}): SnapshotParts {
  return {
    ...emptyParts(),
    organization: { name: "Consultorio", ownerId: "user-1" },
    ...patch,
  };
}

function client(patch: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    organizationId: ORG,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: null,
    updatedBy: null,
    fullName: "Cliente",
    preferredName: null,
    email: null,
    phone: null,
    status: "ACTIVE",
    preferredModality: "ONLINE",
    assignedProfessionalId: null,
    acquisitionChannel: "OTHER",
    tags: [],
    lastAppointmentAt: null,
    nextAppointmentAt: null,
    administrativeNotes: null,
    // Valores propositalmente errados: a leitura precisa corrigi-los.
    totalAppointments: 99,
    outstandingBalanceInCents: 123456,
    ...patch,
  };
}

function appointment(patch: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    organizationId: ORG,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: null,
    updatedBy: null,
    clientId: "client-1",
    clientName: "Cliente",
    professionalId: "prof-1",
    professionalName: "Profissional",
    startsAt: "2026-09-01T13:00:00.000Z",
    endsAt: "2026-09-01T13:50:00.000Z",
    durationMinutes: 50,
    modality: "ONLINE",
    status: "COMPLETED",
    priceInCents: 18000,
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

function transaction(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn-1",
    organizationId: ORG,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: null,
    updatedBy: null,
    type: "INCOME",
    clientId: "client-1",
    clientName: "Cliente",
    professionalId: "prof-1",
    appointmentId: "appt-1",
    description: "Atendimento",
    amountInCents: 18000,
    status: "PENDING",
    method: null,
    dueDate: "2026-09-01T13:00:00.000Z",
    paidAt: null,
    gateway: null,
    ...patch,
  };
}

describe("montagem do snapshot do Firestore", () => {
  it("aguarda o documento da organizacao antes de publicar", () => {
    expect(
      assembleSnapshot(
        { ...emptyParts(), organization: null },
        ORG,
        "PSYCHOLOGIST",
        NOW,
      ),
    ).toBeNull();
  });

  it("completa a organizacao com os padroes do produto", () => {
    const snapshot = assembleSnapshot(parts(), ORG, "PSYCHOLOGIST", NOW)!;

    expect(snapshot.organization).toMatchObject({
      id: ORG,
      primaryProfession: "PSYCHOLOGIST",
      currency: "BRL",
      timezone: "America/Sao_Paulo",
    });
    expect(snapshot.organization.settings.privacy.blockConversationToCrmCopy).toBe(
      true,
    );
    expect(snapshot.organization.settings.agenda.allowDoubleBooking).toBe(false);
  });

  it("regras fundamentais existem mesmo com a colecao vazia", () => {
    const snapshot = assembleSnapshot(parts(), ORG, "PSYCHOLOGIST", NOW)!;
    const levels = new Set(snapshot.rules.map((rule) => rule.level));

    expect(levels.has("SECURITY")).toBe(true);
    expect(levels.has("SYSTEM")).toBe(true);
    expect(levels.has("PROFESSION")).toBe(true);
    expect(snapshot.rules.every((rule) => rule.organizationId === ORG)).toBe(
      true,
    );
  });

  it("documento gravado nao consegue se passar por regra fundamental", () => {
    const seeded = assembleSnapshot(parts(), ORG, "PSYCHOLOGIST", NOW)!.rules.find(
      (rule) => rule.level === "SECURITY",
    )!;

    const forged: AIRule = {
      ...seeded,
      name: "Regra adulterada",
      enabled: false,
      immutable: false,
    };
    const alsoForged: AIRule = { ...forged, id: "outra", immutable: true };

    const snapshot = assembleSnapshot(
      parts({ aiRules: [forged, alsoForged] }),
      ORG,
      "PSYCHOLOGIST",
      NOW,
    )!;

    expect(snapshot.rules.find((rule) => rule.id === seeded.id)).toEqual(seeded);
    expect(snapshot.rules.some((rule) => rule.id === "outra")).toBe(false);
  });

  it("recalcula agregados do cadastro a partir da agenda e do financeiro", () => {
    const snapshot = assembleSnapshot(
      parts({
        clients: [client()],
        appointments: [
          appointment(),
          appointment({
            id: "appt-2",
            status: "SCHEDULED",
            startsAt: "2026-12-01T13:00:00.000Z",
            endsAt: "2026-12-01T13:50:00.000Z",
          }),
        ],
        transactions: [transaction()],
      }),
      ORG,
      "PSYCHOLOGIST",
      NOW,
    )!;

    expect(snapshot.clients[0]).toMatchObject({
      totalAppointments: 1,
      lastAppointmentAt: "2026-09-01T13:00:00.000Z",
      nextAppointmentAt: "2026-12-01T13:00:00.000Z",
      outstandingBalanceInCents: 18000,
    });
  });

  it("receita vencida aparece em atraso sem depender de job noturno", () => {
    const snapshot = assembleSnapshot(
      parts({ transactions: [transaction()] }),
      ORG,
      "PSYCHOLOGIST",
      NOW,
    )!;

    expect(snapshot.transactions[0].status).toBe("OVERDUE");
  });

  it("mensagens saem em ordem cronologica para a leitura da conversa", () => {
    const base = {
      organizationId: ORG,
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: null,
      updatedBy: null,
      conversationId: "conv-1",
      clientId: "client-1",
      direction: "INBOUND" as const,
      authorType: "CLIENT" as const,
      authorName: "Cliente",
      channel: "WHATSAPP" as const,
      readAt: null,
      classification: null,
      classificationConfidence: null,
      aiDecisionId: null,
    };

    const snapshot = assembleSnapshot(
      parts({
        messages: [
          { ...base, id: "m2", body: "segunda", sentAt: "2026-09-09T12:00:00.000Z" },
          { ...base, id: "m1", body: "primeira", sentAt: "2026-09-09T11:00:00.000Z" },
        ],
      }),
      ORG,
      "PSYCHOLOGIST",
      NOW,
    )!;

    expect(snapshot.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
  });
});
