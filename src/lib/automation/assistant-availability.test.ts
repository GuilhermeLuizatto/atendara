import { describe, expect, it } from "vitest";

import { withOrganizationDefaults } from "@/config/organization";

import {
  assistantReplySchedule,
  hasActiveAppointment,
  isWithinAssistantQuietHours,
  isWithinBusinessHours,
} from "./assistant-availability";

const NOW = "2026-10-09T15:00:00.000Z"; // sexta, 12h em São Paulo

function organization() {
  const result = withOrganizationDefaults(
    { name: "Consultório", timezone: "America/Sao_Paulo" },
    "org-1",
    "PSYCHOLOGIST",
    NOW,
  );
  result.settings.agenda.workingDays = [1, 2, 3, 4, 5];
  result.settings.agenda.workdayStart = "08:00";
  result.settings.agenda.workdayEnd = "18:00";
  result.settings.ai.unansweredDelayMinutes = 15;
  return result;
}

describe("disponibilidade da Dara para a conversa", () => {
  it("espera o prazo humano dentro do expediente", () => {
    expect(
      assistantReplySchedule({
        organization: organization(),
        now: NOW,
        activeAppointment: false,
      }),
    ).toEqual({
      scheduledFor: "2026-10-09T15:15:00.000Z",
      trigger: "HUMAN_RESPONSE_TIMEOUT",
    });
  });

  it("responde imediatamente fora do expediente ou durante atendimento", () => {
    const org = organization();
    expect(isWithinBusinessHours(org, NOW)).toBe(true);
    expect(
      assistantReplySchedule({ organization: org, now: NOW, activeAppointment: true }),
    ).toMatchObject({ scheduledFor: NOW, trigger: "ACTIVE_APPOINTMENT" });

    const outside = "2026-10-09T23:00:00.000Z";
    expect(isWithinBusinessHours(org, outside)).toBe(false);
    expect(
      assistantReplySchedule({ organization: org, now: outside, activeAppointment: false }),
    ).toMatchObject({ scheduledFor: outside, trigger: "OUTSIDE_BUSINESS_HOURS" });
  });

  it("detecta atendimento ativo e preserva a janela de silêncio explícita", () => {
    const org = organization();
    org.settings.ai.quietHoursStart = "11:00";
    org.settings.ai.quietHoursEnd = "13:00";
    expect(isWithinAssistantQuietHours(org, NOW)).toBe(true);
    expect(
      hasActiveAppointment(
        [
          {
            professionalId: "prof-1",
            startsAt: "2026-10-09T14:30:00.000Z",
            endsAt: "2026-10-09T15:20:00.000Z",
            status: "CONFIRMED",
          },
        ],
        "prof-1",
        NOW,
      ),
    ).toBe(true);
  });
});
