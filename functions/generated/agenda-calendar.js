// Gerado por scripts/build-functions.mjs.
import { CALENDAR_BUSY_STALE_MINUTES, CALENDAR_EVENT_DISCLOSURE, CALENDAR_PRIVATE_EVENT_TITLE, } from "./calendar-config.js";
/**
 * O que o evento diz, pelo grau de exposição da profissão.
 *
 * No grau mais fechado sobra "Atendimento" e o horário — de propósito: quem
 * olha o celular na mesa vê que há compromisso, e não quem é.
 */
export function calendarEventFor(input) {
    const policy = CALENDAR_EVENT_DISCLOSURE[input.disclosure];
    const partes = [];
    if (policy.includeServiceTerm)
        partes.push(input.serviceTerm);
    if (policy.includeClientName)
        partes.push(input.appointment.clientName);
    return {
        summary: partes.length > 0 ? partes.join(" — ") : CALENDAR_PRIVATE_EVENT_TITLE,
        startsAt: input.appointment.startsAt,
        endsAt: input.appointment.endsAt,
        // Descrição sempre vazia: é onde texto pessoal costuma vazar sem ninguém
        // perceber, e nada do que ela carregaria é necessário para a agenda.
        description: null,
    };
}
/**
 * O que fazer no Google depois de uma mudança no Atendara.
 *
 * A fonte da verdade é daqui: o Google recebe o reflexo. Atendimento cancelado
 * some da agenda; remarcado muda de horário; sem evento e ainda ativo, nasce.
 */
export function decideCalendarSync(input) {
    const { before, after, externalEventId } = input;
    const encerrado = (status) => status === "CANCELLED" || status === "NO_SHOW";
    if (!after || encerrado(after.status))
        return externalEventId ? "DELETE" : "NONE";
    if (!externalEventId)
        return "CREATE";
    const mudou = !before ||
        before.startsAt !== after.startsAt ||
        before.endsAt !== after.endsAt ||
        before.clientName !== after.clientName ||
        encerrado(before.status) !== encerrado(after.status);
    return mudou ? "UPDATE" : "NONE";
}
/**
 * Lê a resposta de livre/ocupado do Google e devolve **só faixas de tempo**.
 *
 * Qualquer outro campo é descartado aqui, e não lá na frente: o que não é lido
 * não tem como ser gravado por engano.
 */
export function parseBusyBlocks(data) {
    if (typeof data !== "object" || data === null)
        return [];
    const calendars = data.calendars;
    if (typeof calendars !== "object" || calendars === null)
        return [];
    const blocks = [];
    for (const calendar of Object.values(calendars)) {
        const busy = calendar?.busy;
        if (!Array.isArray(busy))
            continue;
        for (const entry of busy) {
            const start = entry?.start;
            const end = entry?.end;
            if (typeof start !== "string" || typeof end !== "string")
                continue;
            const startMs = Date.parse(start);
            const endMs = Date.parse(end);
            if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
                continue;
            blocks.push({ startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString() });
        }
    }
    return blocks.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
/**
 * O ocupado lido ainda serve?
 *
 * Entre uma leitura e outra, um compromisso novo no Google não existe para o
 * Atendara. Velho demais, o bloco deixa de valer como prova de vaga — e a
 * oferta de horários prefere escalar a oferecer um horário que já foi tomado.
 */
export function isBusySnapshotFresh(readAt, now) {
    if (!readAt)
        return false;
    return Date.parse(now) - Date.parse(readAt) <= CALENDAR_BUSY_STALE_MINUTES * 60_000;
}
