import { CHANNEL_META } from "@/config/notifications";
import { formatDate, formatTime } from "@/lib/utils/format";
import type {
  Appointment,
  AppointmentNotificationEvent,
  Client,
  ID,
  ISODateString,
  NotificationEligibility,
  NotificationRule,
  NotificationSkipReason,
  OutboundChannel,
  Organization,
  ProfessionConfig,
} from "@/types";

import {
  currentConsentRecord,
  isCompleteConsentRecord,
  isRecordFormat,
} from "./consent-record";
import { contactFor, hasRawContact } from "./contacts";
import { deliveryKey } from "./delivery";
import { scheduledTimeFor } from "./schedule";
import { renderTemplate, type TemplateContext } from "./templates";

/**
 * O portao.
 *
 * Toda condicao que separa "a agenda mudou" de "uma mensagem sai" esta nesta
 * funcao, em ordem, e cada recusa tem um motivo nomeado. Duas consequencias:
 *
 * - a interface consegue dizer POR QUE nada foi enviado, em vez de mostrar uma
 *   lista vazia que tanto pode ser "esta tudo certo" quanto "esta tudo errado";
 * - os testes conseguem afirmar cada trava isoladamente.
 *
 * A ordem nao e estetica. Primeiro o que a organizacao decidiu, depois o que a
 * profissao permite, depois o que o titular consentiu, e so entao o texto — de
 * modo que a recusa relatada seja a causa mais alta, e nao a ultima encontrada.
 */
export interface EligibilityInput {
  organization: Organization;
  profession: ProfessionConfig;
  appointment: Appointment;
  client: Client;
  professionalName: string | null;
  event: AppointmentNotificationEvent;
  now: ISODateString;
  /** Ids de entregas ja existentes. E o que torna o replanejamento inofensivo. */
  existingDeliveryIds: readonly ID[];
}

export function evaluateRule(
  rule: NotificationRule,
  input: EligibilityInput,
): NotificationEligibility {
  const settings = input.organization.settings.notifications;

  // 1. O que a organizacao decidiu.
  if (!settings.enabled) return deny("ORGANIZATION_DISABLED");
  if (rule.event !== input.event) return deny("NO_RULE_FOR_EVENT");
  if (!rule.enabled) return deny("RULE_DISABLED");
  if (!settings.verifiedSenderChannels.includes(rule.channel)) {
    return deny("SENDER_NOT_VERIFIED");
  }

  // 2. O que a profissao permite.
  const professionRules = input.profession.notifications;
  if (!professionRules.allowedEvents.includes(input.event)) {
    return deny("EVENT_NOT_ALLOWED_FOR_PROFESSION");
  }
  if (!professionRules.allowedChannels.includes(rule.channel)) {
    return deny("CHANNEL_NOT_ALLOWED_FOR_PROFESSION");
  }

  // 3. O que o titular consentiu.
  const consentProblem = consentProblemFor(input.client, rule.channel);
  if (consentProblem) return deny(consentProblem);

  // 4. Se existe destino utilizavel.
  if (!hasRawContact(input.client, rule.channel)) return deny("MISSING_CONTACT");
  if (!contactFor(input.client, rule.channel)) return deny("INVALID_CONTACT");

  // 5. Se o horario de envio ainda esta a frente.
  const scheduledFor = scheduledTimeFor({
    event: input.event,
    startsAt: input.appointment.startsAt,
    changedAt: input.now,
    leadMinutes: rule.leadMinutes,
  });
  if (Date.parse(scheduledFor) < Date.parse(input.now)) {
    return deny("SCHEDULE_IN_THE_PAST");
  }

  // 6. Se ja existe um envio identico planejado.
  const id = deliveryKey({
    appointmentId: input.appointment.id,
    event: input.event,
    channel: rule.channel,
    scheduledFor,
  });
  if (input.existingDeliveryIds.includes(id)) return deny("ALREADY_PLANNED");

  // 7. Se o texto sobrevive a politica de conteudo.
  const rendered = renderTemplate(
    rule.customTemplate ?? professionRules.templates[input.event],
    templateContext(input),
    {
      disclosure: professionRules.disclosure,
      maxBodyLength: CHANNEL_META[rule.channel].maxBodyLength,
    },
  );
  if (!rendered.ok) return deny("TEMPLATE_REJECTED");

  return { eligible: true, scheduledFor, body: rendered.value };
}

function deny(
  reason: Exclude<NotificationEligibility, { eligible: true }>["reason"],
): NotificationEligibility {
  return { eligible: false, reason };
}

/**
 * O consentimento, isolado, porque e conferido duas vezes: ao planejar e de novo
 * na hora de enviar. Retirar entre uma coisa e outra tem de impedir o envio —
 * se a conferencia so existisse no planejamento, o aviso ja planejado sairia.
 *
 * O aceite geral e o registro do canal sao exigidos juntos, e o registro precisa
 * estar completo: data, versao do texto, quem registrou, meio e, para menor de
 * idade, o responsavel legal. O consentimento do formato antigo, com uma data
 * so e sem autor, nao autoriza canal nenhum.
 */
export function consentProblemFor(
  client: Pick<Client, "appointmentNotificationsEnabled" | "notificationConsent">,
  channel: OutboundChannel,
): NotificationSkipReason | null {
  const consent = client.notificationConsent;
  if (client.appointmentNotificationsEnabled !== true || !consent) {
    return "MISSING_CONSENT";
  }
  if (!isRecordFormat(consent)) return "CONSENT_INCOMPLETE";

  const record = currentConsentRecord(consent, channel);
  if (!record) return "CHANNEL_NOT_CONSENTED";
  if (record.withdrawn) return "CONSENT_REVOKED";
  if (!isCompleteConsentRecord(record)) return "CONSENT_INCOMPLETE";
  return null;
}

export function templateContext(input: EligibilityInput): TemplateContext {
  return {
    clientName: input.client.preferredName ?? firstName(input.client.fullName),
    organizationName: input.organization.name,
    professionalName:
      input.professionalName ?? input.appointment.professionalName,
    serviceTerm: input.profession.terminology.appointment.singularLower,
    date: formatDate(input.appointment.startsAt),
    time: formatTime(input.appointment.startsAt),
  };
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
