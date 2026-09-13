import { getProfession } from "@/config/professions";
import {
  ANCHOR,
  APPOINTMENT_START,
  appointment,
  client,
  organization,
  reminderRule,
} from "@/lib/notifications/fixtures";
import type { NotificationRule } from "@/types";

import { planAppointmentChange, type AppointmentChangeInput } from "./appointment-changes";

/**
 * Fixtures dos testes da fila. Reaproveitam as de `lib/notifications`: destinos
 * ficticios por construcao (DDD 00, dominios `.test` e `.invalid`).
 */

export { ANCHOR, APPOINTMENT_START };

/** Uma hora antes do inicio: o lembrete da regra padrao das fixtures. */
export const REMINDER_AT = "2026-09-10T23:00:00.000Z";

export const PROFESSIONAL_NAME = "Sam Fictício";

export function confirmationRule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return reminderRule({
    id: "regra-confirmacao",
    event: "APPOINTMENT_CONFIRMED",
    leadMinutes: 0,
    ...overrides,
  });
}

/** Uma escrita de atendimento como o gatilho a recebe: por padrao, o agendamento. */
export function changeInput(overrides: Partial<AppointmentChangeInput> = {}): AppointmentChangeInput {
  const org = overrides.organization === undefined ? organization() : overrides.organization;
  const current = overrides.current === undefined ? appointment() : overrides.current;
  return {
    organization: org,
    profession: org ? getProfession(org.primaryProfession) : null,
    before: null,
    after: current,
    current,
    client: client(),
    professionalName: PROFESSIONAL_NAME,
    tasks: [],
    deliveries: [],
    changedAt: ANCHOR,
    ...overrides,
  };
}

/** O lembrete que o gatilho planeja ao agendar com a configuracao padrao. */
export function plannedReminder() {
  const [created] = planAppointmentChange(changeInput()).created;
  if (!created) throw new Error("A fixture deveria planejar um lembrete.");
  return created;
}
