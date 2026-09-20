import { describe, expect, it } from "vitest";

import { DEFAULT_RESCHEDULE_POLICY, RESCHEDULE_HOLD_MINUTES } from "@/config/reschedule";
import type { Appointment } from "@/types";

import type { AvailabilityInput } from "./availability";
import { confirmReschedule, decideReschedule, policyOf } from "./reschedule";

const AGORA = "2026-09-21T11:00:00.000Z";

const DISPONIBILIDADE: Omit<AvailabilityInput, "durationMinutes"> = {
  agenda: { workingDays: [1, 2, 3, 4, 5], workdayStart: "08:00", workdayEnd: "12:00", slotIntervalMinutes: 30 },
  bufferMinutes: 10,
  from: "2026-09-22T11:00:00.000Z",
  to: "2026-09-22T15:00:00.000Z",
  busy: [],
  timezoneOffsetMinutes: -180,
};

function atendimento(patch: Partial<Appointment> = {}): Appointment {
  return {
    id: "atendimento-1",
    organizationId: "org-1",
    clientId: "cliente-1",
    clientName: "Alex Fictício",
    professionalId: "profissional-1",
    professionalName: "Sam Fictício",
    startsAt: "2026-09-25T13:00:00.000Z",
    endsAt: "2026-09-25T13:50:00.000Z",
    durationMinutes: 50,
    modality: "IN_PERSON",
    status: "SCHEDULED",
    priceInCents: 20_000,
    administrativeNotes: null,
    origin: "MANUAL",
    confirmedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    rescheduledFromId: null,
    externalCalendar: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdBy: "membro",
    updatedAt: "2026-09-01T12:00:00.000Z",
    updatedBy: "membro",
    ...patch,
  };
}

const LIGADA = policyOf({ enabled: true });

function decidir(patch: Parameters<typeof decideReschedule>[0] | Partial<Parameters<typeof decideReschedule>[0]> = {}) {
  return decideReschedule({
    policy: LIGADA,
    appointment: atendimento(),
    previousReschedules: 0,
    availability: DISPONIBILIDADE,
    now: AGORA,
    ...patch,
  });
}

describe("a politica", () => {
  it("nasce desligada: sem escolha da organizacao, o pedido vai para a equipe", () => {
    expect(DEFAULT_RESCHEDULE_POLICY.enabled).toBe(false);
    expect(decidir({ policy: policyOf(null) })).toEqual({ kind: "ESCALATE", reason: "POLICY_DISABLED" });
  });

  it("o que a organizacao nao escolheu vem do padrao", () => {
    expect(policyOf({ enabled: true, offeredSlots: 5 })).toMatchObject({
      enabled: true,
      offeredSlots: 5,
      minimumNoticeHours: DEFAULT_RESCHEDULE_POLICY.minimumNoticeHours,
      allowProfessionalChange: false,
    });
  });
});

describe("pode remarcar?", () => {
  it("dentro da politica, oferece a quantidade escolhida e segura a escolha", () => {
    const decisao = decidir();
    if (decisao.kind !== "OFFER") throw new Error(decisao.kind);

    expect(decisao.slots).toHaveLength(LIGADA.offeredSlots);
    expect(decisao.holdEndsAt).toBe(new Date(Date.parse(AGORA) + RESCHEDULE_HOLD_MINUTES * 60_000).toISOString());
  });

  it("pedido em cima da hora vira trabalho da equipe, mesmo havendo vaga", () => {
    const daquiA2Horas = atendimento({ startsAt: "2026-09-21T13:00:00.000Z", endsAt: "2026-09-21T13:50:00.000Z" });
    expect(decidir({ appointment: daquiA2Horas })).toEqual({ kind: "ESCALATE", reason: "TOO_LATE" });
  });

  it("o limite de remarcacoes por atendimento e respeitado", () => {
    expect(decidir({ previousReschedules: 1 })).toEqual({ kind: "ESCALATE", reason: "LIMIT_REACHED" });
    expect(decidir({ policy: policyOf({ enabled: true, maxReschedulesPerAppointment: 2 }), previousReschedules: 1 }).kind).toBe(
      "OFFER",
    );
  });

  it("sem atendimento futuro, cancelado ou faltou: escala com o motivo certo", () => {
    expect(decidir({ appointment: null })).toEqual({ kind: "ESCALATE", reason: "APPOINTMENT_NOT_FOUND" });
    for (const status of ["CANCELLED", "NO_SHOW"] as const) {
      expect(decidir({ appointment: atendimento({ status }) })).toEqual({
        kind: "ESCALATE",
        reason: "APPOINTMENT_NOT_ACTIVE",
      });
    }
  });

  it("agenda cheia escala em vez de oferecer nada", () => {
    const lotada = { ...DISPONIBILIDADE, busy: [{ startsAt: "2026-09-22T10:00:00.000Z", endsAt: "2026-09-22T16:00:00.000Z" }] };
    expect(decidir({ availability: lotada })).toEqual({ kind: "ESCALATE", reason: "NO_SLOTS" });
  });
});

describe("confirmar o horario escolhido", () => {
  const escolhido = { startsAt: "2026-09-22T11:00:00.000Z", endsAt: "2026-09-22T11:50:00.000Z" };
  const reservaAte = "2026-09-21T11:10:00.000Z";

  it("grava o horario novo, volta para marcado e registra a origem", () => {
    const confirmacao = confirmReschedule({
      appointment: atendimento({ confirmedAt: "2026-09-20T12:00:00.000Z", status: "CONFIRMED" }),
      chosen: escolhido,
      busy: [],
      bufferMinutes: 10,
      holdEndsAt: reservaAte,
      now: AGORA,
    });
    if (confirmacao.kind !== "CONFIRM") throw new Error(confirmacao.kind);

    expect(confirmacao.appointment).toMatchObject({
      startsAt: escolhido.startsAt,
      endsAt: escolhido.endsAt,
      status: "SCHEDULED",
      confirmedAt: null,
      origin: "CLIENT_SELF_SERVICE",
    });
  });

  it("horario ocupado no meio do caminho nao vira dois atendimentos no mesmo horario", () => {
    const confirmacao = confirmReschedule({
      appointment: atendimento(),
      chosen: escolhido,
      busy: [{ startsAt: "2026-09-22T11:30:00.000Z", endsAt: "2026-09-22T12:20:00.000Z" }],
      bufferMinutes: 10,
      holdEndsAt: reservaAte,
      now: AGORA,
    });
    expect(confirmacao).toEqual({ kind: "RETRY", reason: "SLOT_TAKEN" });
  });

  it("o proprio atendimento nao bloqueia o horario novo: ele esta saindo do antigo", () => {
    const atual = atendimento({ startsAt: "2026-09-22T11:00:00.000Z", endsAt: "2026-09-22T11:50:00.000Z" });
    const confirmacao = confirmReschedule({
      appointment: atual,
      chosen: { startsAt: atual.startsAt, endsAt: atual.endsAt },
      busy: [{ startsAt: atual.startsAt, endsAt: atual.endsAt }],
      bufferMinutes: 10,
      holdEndsAt: reservaAte,
      now: AGORA,
    });
    expect(confirmacao.kind).toBe("CONFIRM");
  });

  it("reserva vencida nao confirma: o horario voltou a ser de quem quiser", () => {
    const confirmacao = confirmReschedule({
      appointment: atendimento(),
      chosen: escolhido,
      busy: [],
      bufferMinutes: 10,
      holdEndsAt: reservaAte,
      now: "2026-09-21T11:11:00.000Z",
    });
    expect(confirmacao).toEqual({ kind: "RETRY", reason: "HOLD_EXPIRED" });
  });
});
