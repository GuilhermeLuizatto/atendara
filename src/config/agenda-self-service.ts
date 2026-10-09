import type { AgendaSelfServicePolicy } from "@/types";

/**
 * Politica das jornadas transacionais da Dara. Nasce desligada: autorizar uma
 * resposta administrativa nao autoriza, por si so, a mudar a agenda.
 */
export const DEFAULT_AGENDA_SELF_SERVICE_POLICY: AgendaSelfServicePolicy = {
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
} as const;

export function agendaSelfServicePolicyOf(
  saved: Partial<AgendaSelfServicePolicy> | null | undefined,
): AgendaSelfServicePolicy {
  return { ...DEFAULT_AGENDA_SELF_SERVICE_POLICY, ...(saved ?? {}) };
}
