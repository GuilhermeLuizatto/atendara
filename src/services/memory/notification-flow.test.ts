import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RETRY_POLICY } from "@/config/notifications";
import { SIMULATED_DESTINATIONS } from "@/lib/notifications";
import type { NotificationRule, OutboundChannel } from "@/types";

import type { AppointmentInput } from "../types";
import { MemoryWorkspaceRepository } from "./memory-repository";

/**
 * O ciclo inteiro no repositorio: configurar, agendar, confirmar, disparar.
 *
 * Roda contra a implementacao em memoria porque ela e a que nao precisa de
 * emulador — e porque as duas implementacoes compartilham o mesmo nucleo
 * (`src/services/notifications.ts`), entao o que vale aqui vale la.
 *
 * Todos os destinos sao ficticios: telefones com DDD 00, que nao existe no
 * Brasil, e enderecos em `.test`/`.invalid`, TLDs reservados.
 */

const NOW = "2026-09-09T15:00:00.000Z";
const START = "2026-09-10T15:00:00.000Z";

let repo: MemoryWorkspaceRepository;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  repo = new MemoryWorkspaceRepository("PERSONAL_TRAINER");
  repo.setActor({ userId: "owner", name: "Titular", role: "OWNER" });
});

afterEach(() => vi.useRealTimers());

function rule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "regra-lembrete",
    event: "APPOINTMENT_REMINDER",
    channel: "SMS",
    enabled: true,
    leadMinutes: 60,
    customTemplate: null,
    ...overrides,
  };
}

async function enable(
  rules: NotificationRule[],
  channels: OutboundChannel[] = ["SMS"],
): Promise<void> {
  await repo.updateNotificationSettings({
    enabled: true,
    verifiedSenderChannels: channels,
    rules,
  });
}

async function createClientWithConsent(
  phone = "+5500900000000",
  channels: OutboundChannel[] = ["SMS"],
): Promise<string> {
  const id = await repo.createClient({
    fullName: "Alex Ficticio",
    preferredName: "Alex",
    email: "destino@exemplo.test",
    phone,
    status: "ACTIVE",
    preferredModality: "IN_PERSON",
    assignedProfessionalId: null,
    acquisitionChannel: "OTHER",
    tags: [],
    administrativeNotes: null,
    appointmentNotificationsEnabled: true,
  });

  // O aceite geral entra pelo formulario; o consentimento por canal e um campo
  // proprio, e sem ele nada sai.
  const snapshot = repo.getSnapshot();
  const client = snapshot.clients.find((item) => item.id === id)!;
  client.notificationConsent = {
    channels,
    grantedAt: NOW,
    revokedAt: null,
    source: "CLIENT_FORM",
  };

  return id;
}

async function schedule(clientId: string): Promise<string> {
  const professionalId = repo.getSnapshot().professionals[0].id;
  const input: AppointmentInput = {
    clientId,
    professionalId,
    startsAt: START,
    durationMinutes: 60,
    modality: "IN_PERSON",
    status: "SCHEDULED",
    priceInCents: 12_000,
    administrativeNotes: null,
  };
  return repo.createAppointment(input);
}

const deliveries = () => repo.getSnapshot().notificationDeliveries;

describe("o padrao e nao enviar", () => {
  it("a organizacao nasce com avisos desligados e sem regra", () => {
    expect(repo.getSnapshot().organization.settings.notifications).toEqual({
      enabled: false,
      verifiedSenderChannels: [],
      rules: [],
    });
    expect(deliveries()).toEqual([]);
  });

  it("agendar e confirmar sem configuracao nao cria entrega nenhuma", async () => {
    const clientId = await createClientWithConsent();
    const appointmentId = await schedule(clientId);
    await repo.setAppointmentStatus(appointmentId, "CONFIRMED");

    expect(deliveries()).toEqual([]);
  });

  it("com lembrete configurado, confirmar continua sem enviar", async () => {
    // Tudo ligado — mas para o evento de LEMBRETE. A confirmacao nao herda a
    // regra do lembrete, entao confirmar segue sendo so confirmar.
    await enable([rule()]);
    const clientId = await createClientWithConsent();
    const appointmentId = await schedule(clientId);

    const beforeConfirm = deliveries().length;
    await repo.setAppointmentStatus(appointmentId, "CONFIRMED");

    expect(deliveries()).toHaveLength(beforeConfirm);
    expect(deliveries().every((item) => item.event === "APPOINTMENT_REMINDER")).toBe(true);
  });

  it("sem consentimento de canal, nada e planejado", async () => {
    await enable([rule()]);
    const clientId = await repo.createClient({
      fullName: "Sem Consentimento",
      preferredName: null,
      email: null,
      phone: "+5500900000000",
      status: "ACTIVE",
      preferredModality: "IN_PERSON",
      assignedProfessionalId: null,
      acquisitionChannel: "OTHER",
      tags: [],
      administrativeNotes: null,
      appointmentNotificationsEnabled: true,
    });

    await schedule(clientId);
    expect(deliveries()).toEqual([]);
  });
});

describe("planejamento", () => {
  it("agendar com regra valida planeja um lembrete no horario certo", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent();
    await schedule(clientId);

    expect(deliveries()).toHaveLength(1);
    expect(deliveries()[0]).toMatchObject({
      status: "PLANNED",
      attempts: 0,
      event: "APPOINTMENT_REMINDER",
      channel: "SMS",
      providerId: "SIMULATED",
      // Uma hora antes do inicio.
      scheduledFor: "2026-09-10T14:00:00.000Z",
    });
  });

  it("o registro nao guarda texto nem contato inteiro", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent();
    await schedule(clientId);

    const [delivery] = deliveries();
    expect(delivery.contactHint).toBe("***0000");
    expect(delivery.bodyLength).toBeGreaterThan(0);
    expect(Object.keys(delivery)).not.toContain("body");
    expect(JSON.stringify(delivery)).not.toContain("+5500900000000");
  });

  it("cancelar o atendimento cancela o lembrete que ainda nao saiu", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent();
    const appointmentId = await schedule(clientId);

    await repo.setAppointmentStatus(appointmentId, "CANCELLED");

    const reminder = deliveries().find(
      (item) => item.event === "APPOINTMENT_REMINDER",
    );
    expect(reminder).toMatchObject({ status: "CANCELLED", cancelledAt: NOW });
  });

  it("remarcar cancela o lembrete antigo e planeja o novo", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent();
    const appointmentId = await schedule(clientId);
    const original = deliveries()[0].id;

    await repo.updateAppointment(appointmentId, {
      startsAt: "2026-09-10T18:00:00.000Z",
    });

    const byId = new Map(deliveries().map((item) => [item.id, item]));
    expect(byId.get(original)?.status).toBe("CANCELLED");

    const planned = deliveries().filter((item) => item.status === "PLANNED");
    expect(planned).toHaveLength(1);
    expect(planned[0].scheduledFor).toBe("2026-09-10T17:00:00.000Z");
  });
});

describe("disparo com o provedor simulado", () => {
  it("nada vencido, nada disparado", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent();
    await schedule(clientId);

    // A fila nem chega ao provedor: `dueDeliveries` so entrega o que venceu.
    const summary = await repo.dispatchDueNotifications(NOW);
    expect(summary).toMatchObject({ sent: 0, touched: [] });
    expect(deliveries()[0].status).toBe("PLANNED");
  });

  it("no horario, envia e registra o resultado", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent();
    await schedule(clientId);

    const summary = await repo.dispatchDueNotifications("2026-09-10T14:00:00.000Z");

    expect(summary).toMatchObject({ sent: 1, failed: 0, cancelled: 0 });
    expect(deliveries()[0]).toMatchObject({
      status: "SENT",
      attempts: 1,
      sentAt: "2026-09-10T14:00:00.000Z",
      failureCode: null,
    });
    expect(deliveries()[0].providerMessageId).toMatch(/^sim_/);
  });

  it("disparar de novo nao reenvia o que ja saiu", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent();
    await schedule(clientId);

    const at = "2026-09-10T14:00:00.000Z";
    await repo.dispatchDueNotifications(at);
    const again = await repo.dispatchDueNotifications(at);

    expect(again).toMatchObject({ sent: 0, touched: [] });
    expect(deliveries()[0].attempts).toBe(1);
  });

  it("falha temporaria vira nova tentativa, e a terceira encerra", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent(
      SIMULATED_DESTINATIONS.alwaysUnavailable[0],
    );
    await schedule(clientId);

    let at = "2026-09-10T14:00:00.000Z";
    const first = await repo.dispatchDueNotifications(at);
    expect(first).toMatchObject({ retrying: 1 });
    expect(deliveries()[0]).toMatchObject({
      status: "PLANNED",
      attempts: 1,
      nextAttemptAt: "2026-09-10T14:05:00.000Z",
    });

    // Antes da espera terminar, nada acontece.
    expect(await repo.dispatchDueNotifications("2026-09-10T14:02:00.000Z")).toMatchObject({
      sent: 0,
      touched: [],
    });

    at = "2026-09-10T14:05:00.000Z";
    await repo.dispatchDueNotifications(at);
    at = "2026-09-10T14:35:00.000Z";
    const last = await repo.dispatchDueNotifications(at);

    expect(last).toMatchObject({ failed: 1 });
    expect(deliveries()[0]).toMatchObject({
      status: "FAILED",
      attempts: RETRY_POLICY.maxAttempts,
      failureCode: "ATTEMPTS_EXHAUSTED",
      nextAttemptAt: null,
    });
  });

  it("destino recusado nao ganha nova tentativa", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent(
      SIMULATED_DESTINATIONS.invalid[0],
    );
    await schedule(clientId);

    const summary = await repo.dispatchDueNotifications("2026-09-10T14:00:00.000Z");

    expect(summary).toMatchObject({ failed: 1 });
    expect(deliveries()[0]).toMatchObject({
      status: "FAILED",
      attempts: 1,
      failureCode: "INVALID_DESTINATION",
    });
  });

  it("desligar os avisos interrompe o que ja estava planejado", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent();
    await schedule(clientId);

    await repo.updateNotificationSettings({
      enabled: false,
      verifiedSenderChannels: [],
      rules: [rule()],
    });

    const summary = await repo.dispatchDueNotifications("2026-09-10T14:00:00.000Z");

    expect(summary).toMatchObject({ sent: 0, cancelled: 1 });
    expect(deliveries()[0].status).toBe("CANCELLED");
  });

  it("lembrete muito atrasado e cancelado em vez de enviado", async () => {
    await enable([rule()]);
    const clientId = await createClientWithConsent();
    await schedule(clientId);

    // Cinco horas depois do horario planejado, muito alem da janela util.
    const summary = await repo.dispatchDueNotifications("2026-09-10T19:00:00.000Z");

    expect(summary).toMatchObject({ sent: 0, cancelled: 1 });
    expect(deliveries()[0].status).toBe("CANCELLED");
  });
});

describe("trilha", () => {
  it("mudar a configuracao deixa rastro sem copiar modelo", async () => {
    await enable([rule()]);

    const [entry] = repo.getSnapshot().auditLogs;
    expect(entry).toMatchObject({
      action: "UPDATE",
      resource: { type: "organization" },
      summary: "Avisos de atendimento ativados com 1 regra(s).",
    });
    expect(JSON.stringify(entry)).not.toContain("{{");
  });
});
