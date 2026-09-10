import { describe, expect, it } from "vitest";

import { getProfession } from "@/config/professions";
import { APPOINTMENT_EVENT_META } from "@/config/notifications";
import {
  APPOINTMENT_NOTIFICATION_EVENTS,
  type AppointmentNotificationEvent,
  type NotificationRule,
  type Organization,
} from "@/types";

import { evaluateRule, type EligibilityInput } from "./eligibility";
import { planAppointmentNotifications } from "./planner";
import {
  ANCHOR,
  appointment,
  client,
  organization,
  reminderRule,
} from "./fixtures";

function input(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
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
    // A profissao acompanha a organizacao mesmo quando so ela e sobrescrita.
    ...(overrides.organization && !overrides.profession
      ? { profession: getProfession(overrides.organization.primaryProfession) }
      : {}),
  };
}

describe("nada sai sem configuracao explicita", () => {
  it("o padrao do produto e desligado em todos os eventos", () => {
    for (const event of APPOINTMENT_NOTIFICATION_EVENTS) {
      expect(APPOINTMENT_EVENT_META[event].defaultEnabled).toBe(false);
    }
  });

  it("organizacao recem criada nao planeja nada, em nenhum evento", () => {
    // `defaultOrganizationSettings` sem sobrescrita: e o estado de quem acabou
    // de se cadastrar.
    const fresh = organization({ enabled: false, verifiedSenderChannels: [], rules: [] });

    for (const event of APPOINTMENT_NOTIFICATION_EVENTS) {
      const plan = planAppointmentNotifications(input({ organization: fresh, event }));
      expect(plan.planned).toEqual([]);
      expect(plan.skipped[0].reason).toBe("ORGANIZATION_DISABLED");
    }
  });

  it("confirmar um atendimento nao envia nada por si so", () => {
    // Tudo configurado para LEMBRETE, e mesmo assim a confirmacao nao produz
    // envio: falta uma regra para o evento de confirmacao. E o criterio de
    // conclusao da etapa, escrito como teste.
    const plan = planAppointmentNotifications(
      input({ event: "APPOINTMENT_CONFIRMED" }),
    );

    expect(plan.planned).toEqual([]);
    expect(plan.skipped).toEqual([
      { ruleId: null, channel: null, reason: "NO_RULE_FOR_EVENT" },
    ]);
  });

  it("com regra propria habilitada, a confirmacao passa a planejar", () => {
    const rule = reminderRule({
      id: "regra-confirmacao",
      event: "APPOINTMENT_CONFIRMED",
      leadMinutes: 0,
    });
    const plan = planAppointmentNotifications(
      input({
        organization: organization({ rules: [rule] }),
        event: "APPOINTMENT_CONFIRMED",
      }),
    );

    expect(plan.planned).toHaveLength(1);
    // Evento ancorado na mudanca: sai no instante em que ela acontece, sem
    // antecedencia.
    expect(plan.planned[0].scheduledFor).toBe(ANCHOR);
  });
});

describe("cada trava, isoladamente", () => {
  const cases: Array<[string, Partial<EligibilityInput>, string]> = [
    [
      "organizacao desligada",
      { organization: organization({ enabled: false }) },
      "ORGANIZATION_DISABLED",
    ],
    [
      "remetente nao comprovado",
      { organization: organization({ verifiedSenderChannels: [] }) },
      "SENDER_NOT_VERIFIED",
    ],
    [
      "regra desativada",
      { organization: organization({ rules: [reminderRule({ enabled: false })] }) },
      "RULE_DISABLED",
    ],
    [
      "sem aceite geral",
      { client: client({ appointmentNotificationsEnabled: false }) },
      "MISSING_CONSENT",
    ],
    [
      "cadastro antigo, so com o aceite geral",
      { client: client({ notificationConsent: null }) },
      "MISSING_CONSENT",
    ],
    [
      "consentimento revogado",
      {
        client: client({
          notificationConsent: {
            channels: ["SMS"],
            grantedAt: ANCHOR,
            revokedAt: ANCHOR,
            source: "CLIENT_FORM",
          },
        }),
      },
      "CONSENT_REVOKED",
    ],
    [
      "consentimento nao cobre o canal",
      {
        client: client({
          notificationConsent: {
            channels: ["EMAIL"],
            grantedAt: ANCHOR,
            revokedAt: null,
            source: "CLIENT_FORM",
          },
        }),
      },
      "CHANNEL_NOT_CONSENTED",
    ],
    ["sem contato", { client: client({ phone: null }) }, "MISSING_CONTACT"],
    [
      "contato que nao vira E.164",
      { client: client({ phone: "999" }) },
      "INVALID_CONTACT",
    ],
    [
      "horario de envio ja passou",
      { now: "2026-09-11T00:30:00.000Z" },
      "SCHEDULE_IN_THE_PAST",
    ],
  ];

  it.each(cases)("%s -> %s", (_label, overrides, reason) => {
    const context = input(overrides);
    const rule = context.organization.settings.notifications.rules[0];
    const decision = evaluateRule(rule, context);

    expect(decision).toEqual({ eligible: false, reason });
  });
});

describe("a profissao decide o que pode ser avisado", () => {
  it("profissao de dado sensivel recusa SMS", () => {
    const org = organization({
      profession: "PSYCHOLOGIST",
      verifiedSenderChannels: ["SMS"],
    });
    const decision = evaluateRule(reminderRule(), input({ organization: org }));

    expect(decision).toEqual({
      eligible: false,
      reason: "CHANNEL_NOT_ALLOWED_FOR_PROFESSION",
    });
  });

  it("profissao de dado sensivel nao avisa agendamento", () => {
    const rule = reminderRule({
      event: "APPOINTMENT_SCHEDULED",
      channel: "EMAIL",
      leadMinutes: 0,
    });
    const org = organization({
      profession: "PSYCHOLOGIST",
      verifiedSenderChannels: ["EMAIL"],
      rules: [rule],
    });

    expect(evaluateRule(rule, input({ organization: org, event: "APPOINTMENT_SCHEDULED" }))).toEqual({
      eligible: false,
      reason: "EVENT_NOT_ALLOWED_FOR_PROFESSION",
    });
  });

  it("o texto que sai muda com a profissao, sem mudar a regra", () => {
    const rule = reminderRule({ channel: "EMAIL" });
    const forTrainer = evaluateRule(
      rule,
      input({
        organization: organization({
          verifiedSenderChannels: ["EMAIL"],
          rules: [rule],
        }),
      }),
    );
    const forPsychologist = evaluateRule(
      rule,
      input({
        organization: organization({
          profession: "PSYCHOLOGIST",
          verifiedSenderChannels: ["EMAIL"],
          rules: [rule],
        }),
      }),
    );

    expect(forTrainer).toMatchObject({ eligible: true });
    expect(forPsychologist).toMatchObject({ eligible: true });
    if (!forTrainer.eligible || !forPsychologist.eligible) return;

    expect(forTrainer.body).toContain("treino");
    expect(forPsychologist.body).not.toContain("sessao");
    expect(forPsychologist.body).not.toContain("Sam Ficticio");
  });
});

describe("modelo personalizado", () => {
  it("passa pela mesma politica de conteudo do modelo da profissao", () => {
    const rule: NotificationRule = reminderRule({
      customTemplate: "Lembrete do seu exame em {{date}}.",
    });
    const org: Organization = organization({ rules: [rule] });

    expect(evaluateRule(rule, input({ organization: org }))).toEqual({
      eligible: false,
      reason: "TEMPLATE_REJECTED",
    });
  });
});

describe("duplicidade", () => {
  it("um envio ja planejado nao e planejado de novo", () => {
    const first = planAppointmentNotifications(input());
    expect(first.planned).toHaveLength(1);

    const again = planAppointmentNotifications(
      input({ existingDeliveryIds: [first.planned[0].id] }),
    );
    expect(again.planned).toEqual([]);
    expect(again.skipped[0].reason).toBe("ALREADY_PLANNED");
  });

  it("duas regras iguais para o mesmo canal produzem um envio so", () => {
    const org = organization({
      rules: [reminderRule(), reminderRule({ id: "regra-duplicada" })],
    });
    const plan = planAppointmentNotifications(input({ organization: org }));

    expect(plan.planned).toHaveLength(1);
    expect(plan.skipped).toEqual([
      { ruleId: "regra-duplicada", channel: "SMS", reason: "ALREADY_PLANNED" },
    ]);
  });

  it("canais diferentes sao envios diferentes", () => {
    const org = organization({
      verifiedSenderChannels: ["SMS", "EMAIL"],
      rules: [reminderRule(), reminderRule({ id: "regra-email", channel: "EMAIL" })],
    });
    const plan = planAppointmentNotifications(input({ organization: org }));

    expect(plan.planned.map((item) => item.channel)).toEqual(["SMS", "EMAIL"]);
    expect(new Set(plan.planned.map((item) => item.id)).size).toBe(2);
  });
});

describe("o que o planejamento carrega", () => {
  it("guarda hash e dica, nunca o texto nem o contato inteiro", () => {
    const plan = planAppointmentNotifications(input());
    const [planned] = plan.planned;

    expect(planned.bodyHash).toHaveLength(8);
    expect(planned.bodyLength).toBe(planned.body.length);
    expect(planned.contactHint).toBe("***0000");
    expect(planned.templateId).toBe(
      "profession:PERSONAL_TRAINER:APPOINTMENT_REMINDER",
    );
  });

  it("a antecedencia da regra decide o horario do envio", () => {
    const event: AppointmentNotificationEvent = "APPOINTMENT_REMINDER";
    const org = organization({ rules: [reminderRule({ leadMinutes: 720 })] });
    const plan = planAppointmentNotifications(input({ organization: org, event }));

    // Atendimento as 00:00 de 11/09; 720 minutos antes sao 12:00 de 10/09.
    expect(plan.planned[0].scheduledFor).toBe("2026-09-10T12:00:00.000Z");
  });
});
