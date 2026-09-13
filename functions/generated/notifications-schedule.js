// Gerado por scripts/build-functions.mjs.
import { APPOINTMENT_EVENT_META } from "./notifications-config.js";
/**
 * Quando o envio deve sair.
 *
 * Dois tipos de evento, e a diferenca importa: lembrete e ancorado no INICIO do
 * atendimento e sai com antecedencia; confirmacao e cancelamento sao ancorados
 * na MUDANCA e saem no instante em que ela acontece. Aplicar antecedencia a um
 * cancelamento produziria um aviso agendado para o passado — que e exatamente o
 * caso que `SCHEDULE_IN_THE_PAST` recusa.
 */
export function scheduledTimeFor(input) {
    const meta = APPOINTMENT_EVENT_META[input.event];
    if (meta.anchor === "CHANGE")
        return input.changedAt;
    const start = Date.parse(input.startsAt);
    return new Date(start - input.leadMinutes * 60_000).toISOString();
}
export function addMinutes(iso, minutes) {
    return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}
export function minutesBetween(from, to) {
    return (Date.parse(to) - Date.parse(from)) / 60_000;
}
