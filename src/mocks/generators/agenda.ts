import { addMinutesISO, atTime, isWeekend, shiftDays } from "@/mocks/dates";
import type {
  Appointment,
  AppointmentStatus,
  Client,
  Professional,
} from "@/types";

import { stamp, type GeneratorContext } from "./context";

const PAST_DAYS = 14;
const FUTURE_DAYS = 10;
const SLOT_HOURS = [8, 9, 10, 11, 14, 15, 16, 17];
const TODAY_SLOT_COUNT = 6;
const OTHER_DAY_SLOT_COUNT = 3;

function pastStatus(roll: number): AppointmentStatus {
  if (roll < 0.85) return "COMPLETED";
  if (roll < 0.92) return "NO_SHOW";
  return "CANCELLED";
}

function futureStatus(roll: number): AppointmentStatus {
  return roll < 0.45 ? "CONFIRMED" : "SCHEDULED";
}

/**
 * Gera a agenda em torno de "hoje". Os status derivam da comparacao do horario
 * com o instante atual, entao o dashboard mostra atendimentos ja realizados
 * pela manha e confirmados a tarde sem nenhum ajuste manual.
 */
export function buildAppointments(
  ctx: GeneratorContext,
  clients: Client[],
  professionals: Professional[],
): Appointment[] {
  const { rng, profession, organizationId, now, today } = ctx;
  const duration = profession.defaultAppointmentDurationMinutes;
  const appointments: Appointment[] = [];
  // Somente quem nao e apenas interessado ocupa a agenda.
  const schedulable = clients.filter((client) => client.status !== "LEAD");
  let sequence = 0;

  for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset += 1) {
    const dateKey = shiftDays(today, offset);
    if (isWeekend(dateKey)) continue;

    const slotCount = offset === 0 ? TODAY_SLOT_COUNT : OTHER_DAY_SLOT_COUNT;
    const hours = rng.sample(SLOT_HOURS, slotCount).sort((a, b) => a - b);

    for (const hour of hours) {
      const client = rng.pick(schedulable);
      const professional =
        professionals.find((p) => p.id === client.assignedProfessionalId) ??
        professionals[0];

      const startsAt = atTime(dateKey, hour, rng.bool(0.25) ? 30 : 0);
      const isPast = startsAt < now;
      const roll = rng.next();
      const status: AppointmentStatus = isPast
        ? pastStatus(roll)
        : futureStatus(roll);

      sequence += 1;
      appointments.push({
        id: `appt-${sequence}`,
        organizationId,
        ...stamp(now),
        clientId: client.id,
        clientName: client.fullName,
        professionalId: professional.id,
        professionalName: professional.displayName,
        startsAt,
        endsAt: addMinutesISO(startsAt, duration),
        durationMinutes: duration,
        modality: client.preferredModality,
        status,
        priceInCents: profession.defaultPriceInCents,
        administrativeNotes: rng.bool(0.15) ? "Primeira vez no horário." : null,
        origin: rng.bool(0.2) ? "AI_AGENT" : "MANUAL",
        confirmedAt: status === "CONFIRMED" ? now : null,
        cancelledAt: status === "CANCELLED" ? startsAt : null,
        cancellationReason:
          status === "CANCELLED" ? "Cancelado pelo cliente." : null,
        rescheduledFromId: null,
        externalCalendar: null,
      });
    }
  }

  return appointments.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Preenche os agregados desnormalizados do CRM. Em producao esses campos serao
 * mantidos por Cloud Functions; aqui sao derivados uma vez na geracao.
 */
export function applyAppointmentAggregates(
  clients: Client[],
  appointments: Appointment[],
  now: string,
): Client[] {
  return clients.map((client) => {
    const own = appointments.filter((a) => a.clientId === client.id);
    const completed = own.filter((a) => a.status === "COMPLETED");
    const upcoming = own.filter(
      (a) =>
        a.startsAt > now &&
        (a.status === "SCHEDULED" || a.status === "CONFIRMED"),
    );

    return {
      ...client,
      totalAppointments: completed.length,
      lastAppointmentAt: completed.at(-1)?.startsAt ?? null,
      nextAppointmentAt: upcoming[0]?.startsAt ?? null,
    };
  });
}
