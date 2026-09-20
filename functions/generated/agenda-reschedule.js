// Gerado por scripts/build-functions.mjs.
import { DEFAULT_RESCHEDULE_POLICY, rescheduleHoldEndsAt } from "./reschedule-config.js";
import { firstAvailableSlots, isSlotFree } from "./agenda-availability.js";
export function policyOf(saved) {
    return { ...DEFAULT_RESCHEDULE_POLICY, ...(saved ?? {}) };
}
export function decideReschedule(input) {
    const { policy, appointment, now } = input;
    if (!policy.enabled)
        return { kind: "ESCALATE", reason: "POLICY_DISABLED" };
    if (!appointment)
        return { kind: "ESCALATE", reason: "APPOINTMENT_NOT_FOUND" };
    if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
        return { kind: "ESCALATE", reason: "APPOINTMENT_NOT_ACTIVE" };
    }
    // Antecedência conta do agora até o horário ATUAL do atendimento: remarcar
    // 20 minutos antes é problema da equipe, mesmo que haja vaga na semana que vem.
    const noticeMs = Date.parse(appointment.startsAt) - Date.parse(now);
    if (noticeMs < policy.minimumNoticeHours * 3_600_000)
        return { kind: "ESCALATE", reason: "TOO_LATE" };
    if (input.previousReschedules >= policy.maxReschedulesPerAppointment) {
        return { kind: "ESCALATE", reason: "LIMIT_REACHED" };
    }
    const slots = firstAvailableSlots({ ...input.availability, durationMinutes: appointment.durationMinutes }, policy.offeredSlots);
    if (slots.length === 0)
        return { kind: "ESCALATE", reason: "NO_SLOTS" };
    return { kind: "OFFER", appointment, slots, holdEndsAt: rescheduleHoldEndsAt(now) };
}
/**
 * A confirmação, já dentro da transação que grava.
 *
 * `busy` tem de ser lido na MESMA transação: ler antes e confirmar depois é
 * exatamente a janela em que dois atendimentos caem no mesmo horário.
 */
export function confirmReschedule(input) {
    if (Date.parse(input.now) > Date.parse(input.holdEndsAt))
        return { kind: "RETRY", reason: "HOLD_EXPIRED" };
    // O próprio atendimento não bloqueia o horário novo: ele está saindo do antigo.
    const others = input.busy.filter((block) => !(block.startsAt === input.appointment.startsAt && block.endsAt === input.appointment.endsAt));
    if (!isSlotFree(input.chosen, others, input.bufferMinutes))
        return { kind: "RETRY", reason: "SLOT_TAKEN" };
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
