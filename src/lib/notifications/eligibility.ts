import { NOTICE_TASK_TYPES } from "@/config/automation";
import { CHANNEL_META } from "@/config/notifications";
import { formatDate, formatTime } from "@/lib/utils/format";
import type {
  Appointment,
  AppointmentNotificationEvent,
  Client,
  ID,
  ISODateString,
  NotificationDelivery,
  NotificationDispatchStopReason,
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
import { hashBody, renderTemplate, type TemplateContext } from "./templates";

/**
 * O portao.
 *
 * Toda condicao que separa "a agenda mudou" de "uma mensagem sai" esta neste
 * arquivo, em ordem, e cada recusa tem um motivo nomeado. Tres consequencias:
 *
 * - a interface consegue dizer POR QUE nada foi enviado, em vez de mostrar uma
 *   lista vazia que tanto pode ser "esta tudo certo" quanto "esta tudo errado";
 * - os testes conseguem afirmar cada trava isoladamente;
 * - planejar e enviar conferem as MESMAS travas: o despachante do backend chama
 *   `recheckBeforeSend` imediatamente antes de cada envio.
 *
 * A ordem nao e estetica. Primeiro o que a organizacao decidiu, depois o que a
 * profissao permite, o que o produto executa, o que o titular consentiu, e so
 * entao o texto — de modo que a recusa relatada seja a causa mais alta, e nao a
 * ultima encontrada.
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

type TemplateInput = Pick<
  EligibilityInput,
  "organization" | "profession" | "appointment" | "client" | "professionalName"
>;

export function evaluateRule(
  rule: NotificationRule,
  input: EligibilityInput,
): NotificationEligibility {
  // 1 a 5. Organizacao, profissao, produto, consentimento e contato.
  const problem = gateProblem(rule, input.event, input);
  if (problem) return deny(problem);

  // 6. Se o horario de envio ainda esta a frente.
  const scheduledFor = scheduledTimeFor({
    event: input.event,
    startsAt: input.appointment.startsAt,
    changedAt: input.now,
    leadMinutes: rule.leadMinutes,
  });
  if (Date.parse(scheduledFor) < Date.parse(input.now)) {
    return deny("SCHEDULE_IN_THE_PAST");
  }

  // 7. Se ja existe um envio identico planejado.
  const id = deliveryKey({
    appointmentId: input.appointment.id,
    event: input.event,
    channel: rule.channel,
    scheduledFor,
  });
  if (input.existingDeliveryIds.includes(id)) return deny("ALREADY_PLANNED");

  // 8. Se o texto sobrevive a politica de conteudo.
  const rendered = renderFor(rule, input.event, input);
  if (!rendered.ok) return deny("TEMPLATE_REJECTED");

  return { eligible: true, scheduledFor, body: rendered.value };
}

function deny(
  reason: Exclude<NotificationEligibility, { eligible: true }>["reason"],
): NotificationEligibility {
  return { eligible: false, reason };
}

/** As travas que valem no planejamento e de novo no envio. */
function gateProblem(
  rule: NotificationRule,
  event: AppointmentNotificationEvent,
  input: Pick<EligibilityInput, "organization" | "profession" | "client">,
): NotificationSkipReason | null {
  const settings = input.organization.settings.notifications;

  // 1. O que a organizacao decidiu.
  if (!settings.enabled) return "ORGANIZATION_DISABLED";
  if (rule.event !== event) return "NO_RULE_FOR_EVENT";
  if (!rule.enabled) return "RULE_DISABLED";
  if (!settings.verifiedSenderChannels.includes(rule.channel)) {
    return "SENDER_NOT_VERIFIED";
  }

  // 2. O que a profissao permite.
  const professionRules = input.profession.notifications;
  if (!professionRules.allowedEvents.includes(event)) {
    return "EVENT_NOT_ALLOWED_FOR_PROFESSION";
  }
  if (!professionRules.allowedChannels.includes(rule.channel)) {
    return "CHANNEL_NOT_ALLOWED_FOR_PROFESSION";
  }

  // 3. O que o produto executa. Sem tarefa no servidor para o evento, nada
  // chega a sair — e planejar prometeria o contrario.
  if (!NOTICE_TASK_TYPES[event]) return "EVENT_WITHOUT_AUTOMATION";

  // 4. O que o titular consentiu.
  const consentProblem = consentProblemFor(input.client, rule.channel);
  if (consentProblem) return consentProblem;

  // 5. Se existe destino utilizavel.
  if (!hasRawContact(input.client, rule.channel)) return "MISSING_CONTACT";
  if (!contactFor(input.client, rule.channel)) return "INVALID_CONTACT";

  return null;
}

function renderFor(
  rule: NotificationRule,
  event: AppointmentNotificationEvent,
  input: TemplateInput,
) {
  const professionRules = input.profession.notifications;
  return renderTemplate(
    rule.customTemplate ?? professionRules.templates[event],
    templateContext(input),
    {
      disclosure: professionRules.disclosure,
      maxBodyLength: CHANNEL_META[rule.channel].maxBodyLength,
    },
  );
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

export function templateContext(input: TemplateInput): TemplateContext {
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

// --------------------------------------------------------------- no envio

export interface SendCheckInput {
  organization: Organization;
  profession: ProfessionConfig;
  /** Estado ATUAL, lido no instante do envio. `null` = nao existe mais. */
  appointment: Appointment | null;
  client: Client | null;
  professionalName: string | null;
  delivery: Pick<NotificationDelivery, "event" | "channel" | "ruleId" | "clientId" | "bodyHash">;
  /**
   * Inicio do atendimento quando o aviso foi planejado. `null` nao confere: o
   * registro da demonstracao nao guarda esse horario.
   */
  plannedForStartsAt: ISODateString | null;
}

export type SendCheck =
  | { ok: true; destination: string; body: string }
  | { ok: false; reason: NotificationDispatchStopReason };

function stop(reason: NotificationDispatchStopReason): SendCheck {
  return { ok: false, reason };
}

/**
 * Recompoe destino e texto do estado atual, passando pelas mesmas travas do
 * planejamento.
 *
 * O registro de entrega nao guarda nenhum dos dois. Recompor agora e o que faz
 * uma retirada de consentimento, uma troca de contato, o desligamento do canal,
 * um cancelamento ou uma remarcacao interromperem um envio JA planejado — e nao
 * apenas os proximos.
 */
export function composeForSend(input: SendCheckInput): SendCheck {
  const { organization, delivery, appointment, client } = input;
  const settings = organization.settings.notifications;

  if (!settings.enabled) return stop("ORGANIZATION_DISABLED");
  const rule = settings.rules.find((item) => item.id === delivery.ruleId);
  if (!rule || rule.channel !== delivery.channel) return stop("RULE_NOT_FOUND");

  if (!appointment) return stop("APPOINTMENT_NOT_FOUND");
  if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
    return stop("APPOINTMENT_CANCELLED");
  }
  if (input.plannedForStartsAt !== null && appointment.startsAt !== input.plannedForStartsAt) {
    return stop("APPOINTMENT_RESCHEDULED");
  }
  if (appointment.clientId !== delivery.clientId) return stop("APPOINTMENT_CLIENT_CHANGED");
  if (!client || client.id !== delivery.clientId) return stop("CLIENT_NOT_FOUND");

  const context: TemplateInput = {
    organization,
    profession: input.profession,
    appointment,
    client,
    professionalName: input.professionalName,
  };
  const problem = gateProblem(rule, delivery.event, context);
  if (problem) return stop(problem);

  const contact = contactFor(client, rule.channel);
  if (!contact) return stop("INVALID_CONTACT");

  const rendered = renderFor(rule, delivery.event, context);
  if (!rendered.ok) return stop("TEMPLATE_REJECTED");

  return { ok: true, destination: contact.destination, body: rendered.value };
}

/**
 * A conferencia do despachante: tudo de `composeForSend` e, por ultimo, o texto.
 * Se ele mudou entre planejar e enviar (modelo editado, cadastro alterado),
 * enviar entregaria algo que ninguem revisou.
 */
export function recheckBeforeSend(input: SendCheckInput): SendCheck {
  const composed = composeForSend(input);
  if (!composed.ok) return composed;
  if (hashBody(composed.body) !== input.delivery.bodyHash) return stop("BODY_CHANGED");
  return composed;
}
