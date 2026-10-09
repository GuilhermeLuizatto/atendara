// Gerado por scripts/build-functions.mjs.
/**
 * Politica das jornadas transacionais da Dara. Nasce desligada: autorizar uma
 * resposta administrativa nao autoriza, por si so, a mudar a agenda.
 */
export const DEFAULT_AGENDA_SELF_SERVICE_POLICY = {
    bookingEnabled: false,
    cancellationEnabled: false,
    minimumCancellationNoticeHours: 24,
    offeredSlots: 3,
    searchWindowDays: 14,
};
export const AGENDA_SELF_SERVICE_LIMITS = {
    minimumCancellationNoticeHours: { min: 0, max: 168 },
    offeredSlots: { min: 2, max: 5 },
    searchWindowDays: { min: 1, max: 60 },
};
export function agendaSelfServicePolicyOf(saved) {
    return { ...DEFAULT_AGENDA_SELF_SERVICE_POLICY, ...(saved ?? {}) };
}
