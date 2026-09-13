import { describe, expect, it } from "vitest";

import { getProfession } from "@/config/professions";

import {
  composeForSend,
  evaluateRule,
  recheckBeforeSend,
  type EligibilityInput,
  type SendCheckInput,
} from "./eligibility";
import {
  ANCHOR,
  appointment,
  client,
  consent,
  consentAct,
  consentRecord,
  organization,
  reminderRule,
} from "./fixtures";
import { planAppointmentNotifications } from "./planner";

/**
 * As travas no envio (Fase 3, 13.2). O despachante do backend chama
 * `recheckBeforeSend` imediatamente antes de cada envio: o que o planejamento
 * conferiu, e o que so da para saber na hora.
 */

function eligibility(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  const org = overrides.organization ?? organization();
  return {
    organization: org,
    profession: getProfession(org.primaryProfession),
    appointment: appointment(),
    client: client(),
    professionalName: "Sam Ficticio",
    event: "APPOINTMENT_REMINDER",
    now: ANCHOR,
    existingDeliveryIds: [],
    ...overrides,
  };
}

function sendInput(overrides: Partial<SendCheckInput> = {}): SendCheckInput {
  const [planned] = planAppointmentNotifications(eligibility()).planned;
  const org = overrides.organization ?? organization();
  return {
    organization: org,
    profession: getProfession(org.primaryProfession),
    appointment: appointment(),
    client: client(),
    professionalName: "Sam Ficticio",
    delivery: { ...planned, bodyHash: planned.bodyHash },
    plannedForStartsAt: appointment().startsAt,
    ...overrides,
  };
}

describe("evento sem execucao no servidor", () => {
  it("agendamento e cancelamento nao planejam nada, mesmo com tudo ligado", () => {
    for (const event of ["APPOINTMENT_SCHEDULED", "APPOINTMENT_CANCELLED"] as const) {
      const rule = reminderRule({ id: `regra-${event}`, event, leadMinutes: 0 });
      const org = organization({ rules: [rule] });
      expect(evaluateRule(rule, eligibility({ organization: org, event }))).toEqual({
        eligible: false,
        reason: "EVENT_WITHOUT_AUTOMATION",
      });
    }
  });
});

describe("conferencia no envio", () => {
  it("recompoe destino e o mesmo texto do planejamento", () => {
    const check = recheckBeforeSend(sendInput());
    expect(check).toMatchObject({ ok: true, destination: "+5500900000000" });
  });

  it("para com motivo nomeado o que mudou depois do planejamento", () => {
    const withdrawn = client({ notificationConsent: consent({ SMS: [consentRecord({ withdrawn: consentAct() })] }) });
    const cases: Array<[string, Partial<SendCheckInput>]> = [
      ["ORGANIZATION_DISABLED", { organization: organization({ enabled: false }) }],
      ["RULE_NOT_FOUND", { organization: organization({ rules: [] }) }],
      ["RULE_NOT_FOUND", { organization: organization({ rules: [reminderRule({ channel: "EMAIL" })] }) }],
      ["RULE_DISABLED", { organization: organization({ rules: [reminderRule({ enabled: false })] }) }],
      ["APPOINTMENT_NOT_FOUND", { appointment: null }],
      ["APPOINTMENT_CANCELLED", { appointment: appointment({ status: "CANCELLED" }) }],
      ["APPOINTMENT_CANCELLED", { appointment: appointment({ status: "NO_SHOW" }) }],
      ["APPOINTMENT_RESCHEDULED", { appointment: appointment({ startsAt: "2026-09-11T03:00:00.000Z" }) }],
      ["APPOINTMENT_CLIENT_CHANGED", { appointment: appointment({ clientId: "cliente-2" }) }],
      ["CLIENT_NOT_FOUND", { client: null }],
      ["CONSENT_REVOKED", { client: withdrawn }],
      ["INVALID_CONTACT", { client: client({ phone: "12" }) }],
    ];
    for (const [reason, overrides] of cases) {
      expect(recheckBeforeSend(sendInput(overrides)), reason).toEqual({ ok: false, reason });
    }
  });

  it("texto alterado so e barrado na conferencia do despachante", () => {
    // O nome pelo qual a pessoa e chamada entra no texto.
    const renamed = client({ preferredName: "Bia" });
    expect(composeForSend(sendInput({ client: renamed })).ok).toBe(true);
    expect(recheckBeforeSend(sendInput({ client: renamed }))).toEqual({ ok: false, reason: "BODY_CHANGED" });
  });

  it("sem o horario planejado, a remarcacao nao e conferida (registro da demonstracao)", () => {
    const check = composeForSend(
      sendInput({ appointment: appointment({ startsAt: "2026-09-11T03:00:00.000Z" }), plannedForStartsAt: null }),
    );
    expect(check.ok).toBe(true);
  });
});
