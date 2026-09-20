import { DEFAULT_RESCHEDULE_POLICY, rescheduleHoldEndsAt, type RescheduleRefusalReason } from "@/config/reschedule";
import type { Appointment, ID, ISODateString, ReschedulePolicy } from "@/types";

import { firstAvailableSlots, isSlotFree, type AvailabilityInput, type AvailableSlot, type BusyBlock } from "./availability";

/**
 * Remarcação pedida pela própria pessoa (Fase 3, 13.6), sem I/O.
 *
 * Duas decisões, e nesta ordem: **pode?** (`decideReschedule`) e **ainda está
 * livre?** (`confirmReschedule`, dentro da transação). Entre uma e outra passa
 * gente escolhendo, e é aí que dois pedidos disputam o mesmo horário — por isso
 * a segunda existe.
 *
 * **Fora da política não é erro, é escalada.** Toda recusa devolve um motivo
 * nomeado, que vira alerta para a equipe: o pedido não some, muda de dono.
 */

export type RescheduleDecision =
  /** Oferecer estes horários e segurar a escolha por poucos minutos. */
  | { kind: "OFFER"; appointment: Appointment; slots: AvailableSlot[]; holdEndsAt: ISODateString }
  /** Não cabe na política: vai para a equipe, com o motivo. */
  | { kind: "ESCALATE"; reason: RescheduleRefusalReason };

export function policyOf(saved: Partial<ReschedulePolicy> | null | undefined): ReschedulePolicy {
  return { ...DEFAULT_RESCHEDULE_POLICY, ...(saved ?? {}) };
}

export function decideReschedule(input: {
  policy: ReschedulePolicy;
  /** Atendimento futuro mais próximo daquela pessoa. */
  appointment: Appointment | null;
  /** Quantas vezes este atendimento já foi remarcado pela pessoa. */
  previousReschedules: number;
  availability: Omit<AvailabilityInput, "durationMinutes">;
  now: ISODateString;
}): RescheduleDecision {
  const { policy, appointment, now } = input;

  if (!policy.enabled) return { kind: "ESCALATE", reason: "POLICY_DISABLED" };
  if (!appointment) return { kind: "ESCALATE", reason: "APPOINTMENT_NOT_FOUND" };
  if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
    return { kind: "ESCALATE", reason: "APPOINTMENT_NOT_ACTIVE" };
  }

  // Antecedência conta do agora até o horário ATUAL do atendimento: remarcar
  // 20 minutos antes é problema da equipe, mesmo que haja vaga na semana que vem.
  const noticeMs = Date.parse(appointment.startsAt) - Date.parse(now);
  if (noticeMs < policy.minimumNoticeHours * 3_600_000) return { kind: "ESCALATE", reason: "TOO_LATE" };

  if (input.previousReschedules >= policy.maxReschedulesPerAppointment) {
    return { kind: "ESCALATE", reason: "LIMIT_REACHED" };
  }

  const slots = firstAvailableSlots(
    { ...input.availability, durationMinutes: appointment.durationMinutes },
    policy.offeredSlots,
  );
  if (slots.length === 0) return { kind: "ESCALATE", reason: "NO_SLOTS" };

  return { kind: "OFFER", appointment, slots, holdEndsAt: rescheduleHoldEndsAt(now) };
}

export type RescheduleConfirmation =
  /** Gravar: o atendimento muda de horário e o pedido se encerra. */
  | { kind: "CONFIRM"; appointment: Appointment }
  /** O horário foi ocupado no meio do caminho, ou a reserva venceu. */
  | { kind: "RETRY"; reason: "SLOT_TAKEN" | "HOLD_EXPIRED" };

/**
 * A confirmação, já dentro da transação que grava.
 *
 * `busy` tem de ser lido na MESMA transação: ler antes e confirmar depois é
 * exatamente a janela em que dois atendimentos caem no mesmo horário.
 */
export function confirmReschedule(input: {
  appointment: Appointment;
  chosen: AvailableSlot;
  busy: readonly BusyBlock[];
  bufferMinutes: number;
  holdEndsAt: ISODateString;
  now: ISODateString;
  /** Id do novo atendimento, quando a organização prefere criar outro. */
  rescheduledFromId?: ID | null;
}): RescheduleConfirmation {
  if (Date.parse(input.now) > Date.parse(input.holdEndsAt)) return { kind: "RETRY", reason: "HOLD_EXPIRED" };

  // O próprio atendimento não bloqueia o horário novo: ele está saindo do antigo.
  const others = input.busy.filter(
    (block) => !(block.startsAt === input.appointment.startsAt && block.endsAt === input.appointment.endsAt),
  );
  if (!isSlotFree(input.chosen, others, input.bufferMinutes)) return { kind: "RETRY", reason: "SLOT_TAKEN" };

  return {
    kind: "CONFIRM",
    appointment: {
      ...input.appointment,
      startsAt: input.chosen.startsAt,
      endsAt: input.chosen.endsAt,
      // Remarcado volta a "marcado": confirmar de novo é da pessoa, no horário novo.
      status: "SCHEDULED",
      confirmedAt: null,
      rescheduledFromId: input.rescheduledFromId ?? input.appointment.rescheduledFromId,
      // Quem mexeu na agenda foi a propria pessoa, e a origem registra isso.
      origin: "CLIENT_SELF_SERVICE",
      updatedAt: input.now,
      updatedBy: null,
    },
  };
}
