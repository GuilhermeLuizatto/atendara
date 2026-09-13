import { describe, expect, it } from "vitest";

import { getProfession } from "@/config/professions";
import { APPOINTMENT_EVENT_META } from "@/config/notifications";
import {
  APPOINTMENT_NOTIFICATION_EVENTS,
  OUTBOUND_CHANNELS,
  type AppointmentNotificationEvent,
  type ChannelConsentRecord,
  type NotificationRule,
  type Organization,
} from "@/types";

import { consentProblemFor, evaluateRule, type EligibilityInput } from "./eligibility";
import { planAppointmentNotifications } from "./planner";
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
      "consentimento do canal retirado",
      {
        client: client({
          notificationConsent: consent({
            SMS: [consentRecord({ withdrawn: consentAct({ medium: "MESSAGE" }) })],
          }),
        }),
      },
      "CONSENT_REVOKED",
    ],
    [
      "nenhum registro para o canal",
      { client: client({ notificationConsent: consent({ EMAIL: [consentRecord()] }) }) },
      "CHANNEL_NOT_CONSENTED",
    ],
    [
      "consentimento no formato antigo, com uma data so e sem autor",
      {
        client: client({
          notificationConsent: {
            channels: ["SMS"],
            grantedAt: ANCHOR,
            revokedAt: null,
            source: "CLIENT_FORM",
            textVersion: "2026-09-11-rascunho",
          },
        }),
      },
      "CONSENT_INCOMPLETE",
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

describe("registro completo do consentimento, por canal", () => {
  const smsWith = (record: unknown) =>
    client({ notificationConsent: consent({ SMS: [record as ChannelConsentRecord] }) });
  const decide = (subject: ReturnType<typeof client>) => {
    const context = input({ client: subject });
    return evaluateRule(context.organization.settings.notifications.rules[0], context);
  };

  function without<T extends object>(value: T, key: keyof T): T {
    const copy = { ...value };
    delete copy[key];
    return copy;
  }

  it.each(["granted", "textVersion", "subjectIsMinor", "legalGuardian", "withdrawn"] as const)(
    "registro sem %s nao autoriza envio",
    (key) => {
      expect(decide(smsWith(without(consentRecord(), key)))).toEqual({
        eligible: false,
        reason: "CONSENT_INCOMPLETE",
      });
    },
  );

  it.each(["at", "recordedBy", "medium"] as const)("autorizacao sem %s nao autoriza envio", (key) => {
    expect(decide(smsWith(consentRecord({ granted: without(consentAct(), key) })))).toEqual({
      eligible: false,
      reason: "CONSENT_INCOMPLETE",
    });
  });

  const incomplete: Array<[string, Partial<ChannelConsentRecord>]> = [
    ["data que nao e instante", { granted: consentAct({ at: "11/09/2026" }) }],
    ["versao do texto vazia", { textVersion: "" }],
    ["versao do texto como frase livre", { textVersion: "Alex aceitou por telefone" }],
    ["equipe sem uid de quem registrou", { granted: consentAct({ recordedBy: { kind: "STAFF", userId: null } }) }],
    [
      "autor de tipo desconhecido",
      { granted: consentAct({ recordedBy: { kind: "SYSTEM" as "STAFF", userId: "x" } }) },
    ],
    ["meio desconhecido", { granted: consentAct({ medium: "PHONE_CALL" as "FORM" }) }],
    ["menor de idade sem responsavel legal", { subjectIsMinor: true, legalGuardian: null }],
    [
      "responsavel legal sem nome",
      { subjectIsMinor: true, legalGuardian: { fullName: "  ", relationship: "PARENT" } },
    ],
    [
      "responsavel legal com vinculo desconhecido",
      { subjectIsMinor: true, legalGuardian: { fullName: "Rui Ficticio", relationship: "AVO" as "PARENT" } },
    ],
    [
      "adulto com responsavel legal",
      { subjectIsMinor: false, legalGuardian: { fullName: "Rui Ficticio", relationship: "PARENT" } },
    ],
  ];

  it.each(incomplete)("%s -> CONSENT_INCOMPLETE", (_label, overrides) => {
    expect(decide(smsWith(consentRecord(overrides)))).toEqual({
      eligible: false,
      reason: "CONSENT_INCOMPLETE",
    });
  });

  it("menor de idade com responsavel legal completo recebe", () => {
    const record = consentRecord({
      subjectIsMinor: true,
      legalGuardian: { fullName: "Rui Ficticio", relationship: "LEGAL_GUARDIAN" },
    });
    expect(decide(smsWith(record))).toMatchObject({ eligible: true });
  });

  it("registro feito pela propria pessoa, pelo backend, e completo sem uid de equipe", () => {
    const record = consentRecord({
      granted: consentAct({ recordedBy: { kind: "SUBJECT", userId: null }, medium: "MESSAGE" }),
    });
    expect(decide(smsWith(record))).toMatchObject({ eligible: true });
  });

  it("retirar um canal nao mexe nos outros", () => {
    const subject = client({
      notificationConsent: consent({
        SMS: [consentRecord({ withdrawn: consentAct() })],
        EMAIL: [consentRecord()],
      }),
    });
    expect(consentProblemFor(subject, "SMS")).toBe("CONSENT_REVOKED");
    expect(consentProblemFor(subject, "EMAIL")).toBeNull();
  });

  it("autorizar de novo depois de retirar volta a valer; o registro antigo continua la", () => {
    const withdrawn = consentRecord({ withdrawn: consentAct({ at: "2026-09-10T13:00:00.000Z" }) });
    const again = consentRecord({ granted: consentAct({ at: "2026-09-10T14:00:00.000Z" }) });
    expect(decide(smsWith(withdrawn))).toMatchObject({ reason: "CONSENT_REVOKED" });
    expect(decide(client({ notificationConsent: consent({ SMS: [withdrawn, again] }) }))).toMatchObject({
      eligible: true,
    });
  });

  it("nenhum canal fica elegivel sem o proprio registro completo", () => {
    // Criterio de conclusao da 13.1: os outros canais completos nao emprestam
    // nada ao canal que nao tem registro completo.
    for (const channel of OUTBOUND_CHANNELS) {
      const others = Object.fromEntries(
        OUTBOUND_CHANNELS.filter((item) => item !== channel).map((item) => [item, [consentRecord()]]),
      );
      const rule = reminderRule({ channel });
      const org = organization({ verifiedSenderChannels: [channel], rules: [rule] });
      const variants: Array<[unknown, string]> = [
        [undefined, "CHANNEL_NOT_CONSENTED"],
        [[consentRecord({ withdrawn: consentAct() })], "CONSENT_REVOKED"],
        [[consentRecord({ textVersion: "" })], "CONSENT_INCOMPLETE"],
        [[consentRecord({ subjectIsMinor: true, legalGuardian: null })], "CONSENT_INCOMPLETE"],
      ];

      for (const [history, reason] of variants) {
        const channels = history ? { ...others, [channel]: history } : others;
        const subject = client({ notificationConsent: consent(channels) });
        expect(evaluateRule(rule, input({ organization: org, client: subject })), `${channel} ${reason}`).toEqual({
          eligible: false,
          reason,
        });
      }

      const complete = client({ notificationConsent: consent({ ...others, [channel]: [consentRecord()] }) });
      expect(evaluateRule(rule, input({ organization: org, client: complete })), channel).toMatchObject({
        eligible: true,
      });
    }
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
