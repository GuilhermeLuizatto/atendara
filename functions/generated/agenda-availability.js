// Gerado por scripts/build-functions.mjs.
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
function minutesOfDay(value) {
    const [hours, minutes] = value.split(":");
    return Number(hours) * 60 + Number(minutes);
}
/** Instante -> data e hora no fuso da organização, como minutos desde a meia-noite. */
function localParts(iso, offsetMinutes) {
    const local = new Date(Date.parse(iso) + offsetMinutes * MINUTE_MS);
    const dayStartMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMinutes * MINUTE_MS;
    return { dayStartMs, weekday: local.getUTCDay() };
}
function overlaps(startMs, endMs, block, bufferMs) {
    const busyStart = Date.parse(block.startsAt) - bufferMs;
    const busyEnd = Date.parse(block.endsAt) + bufferMs;
    return startMs < busyEnd && busyStart < endMs;
}
/**
 * Todos os horários livres da janela, em ordem.
 *
 * O passo é `slotIntervalMinutes`, e cada candidato precisa caber **inteiro**
 * dentro do expediente do dia: um atendimento de 50 minutos não começa às
 * 17:30 num expediente que fecha às 18:00.
 */
export function availableSlots(input) {
    const { agenda, durationMinutes, bufferMinutes, timezoneOffsetMinutes: offset } = input;
    if (durationMinutes <= 0 || agenda.slotIntervalMinutes <= 0)
        return [];
    const fromMs = Date.parse(input.from);
    const toMs = Date.parse(input.to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs)
        return [];
    const startMinutes = minutesOfDay(agenda.workdayStart);
    const endMinutes = minutesOfDay(agenda.workdayEnd);
    const bufferMs = Math.max(0, bufferMinutes) * MINUTE_MS;
    const durationMs = durationMinutes * MINUTE_MS;
    const stepMs = agenda.slotIntervalMinutes * MINUTE_MS;
    const slots = [];
    let { dayStartMs } = localParts(input.from, offset);
    while (dayStartMs <= toMs) {
        const { weekday } = localParts(new Date(dayStartMs).toISOString(), offset);
        if (agenda.workingDays.includes(weekday)) {
            const openMs = dayStartMs + startMinutes * MINUTE_MS;
            const closeMs = dayStartMs + endMinutes * MINUTE_MS;
            for (let candidate = openMs; candidate + durationMs <= closeMs; candidate += stepMs) {
                const endsMs = candidate + durationMs;
                if (candidate < fromMs || endsMs > toMs)
                    continue;
                if (input.busy.some((block) => overlaps(candidate, endsMs, block, bufferMs)))
                    continue;
                slots.push({ startsAt: new Date(candidate).toISOString(), endsAt: new Date(endsMs).toISOString() });
            }
        }
        dayStartMs += DAY_MS;
    }
    return slots;
}
/** Os primeiros `limit` horários livres. É o que a oferta pelo canal usa. */
export function firstAvailableSlots(input, limit) {
    return limit <= 0 ? [] : availableSlots(input).slice(0, limit);
}
/**
 * O horário ainda está livre?
 *
 * Conferido de novo **dentro da transação** que reserva: entre oferecer e
 * escolher, alguém pode ter marcado. É esta função que impede dois atendimentos
 * no mesmo horário.
 */
export function isSlotFree(slot, busy, bufferMinutes) {
    const startMs = Date.parse(slot.startsAt);
    const endMs = Date.parse(slot.endsAt);
    return !busy.some((block) => overlaps(startMs, endMs, block, Math.max(0, bufferMinutes) * MINUTE_MS));
}
