import { NOTICE_TASK_TYPES } from "@/config/automation";
import { CHANNEL_META } from "@/config/notifications";
import { formatDate, formatTime } from "@/lib/utils/format";
import { isConversationReplyEvent } from "@/types";
import type {
  AgendaNoticeEvent,
  Appointment,
  AppointmentNotificationEvent,
  Client,
  Conversation,
  ConversationReplyEvent,
  ReplyStage,
  ID,
  ISODateString,
  MessagingSender,
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
import { renderReply, type ReplyContext } from "./replies";
import { whatsappMessageFor, type WhatsappMessage } from "./whatsapp";
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
  /** So mudanca da agenda: resposta na conversa tem portao proprio. */
  event: AgendaNoticeEvent;
  now: ISODateString;
  /** Ids de entregas ja existentes. E o que torna o replanejamento inofensivo. */
  existingDeliveryIds: readonly ID[];
  /**
   * Remetente cadastrado pela operadora para o canal (13.4). `null` quando nao
   * ha cadastro — o que so impede o envio em canal de provedor real.
   */
  sender?: MessagingSender | null;
}

/**
 * A trava do remetente real (13.4).
 *
 * Com provedor simulado nao ha o que conferir: nada sai do processo. Com
 * provedor de verdade, falar pelo numero de uma clinica exige um cadastro que
 * **a propria clinica nao escreve** — ele vem da operadora, pelo backend, com
 * segundo fator e trilha.
 *
 * O modo de teste recusa destino fora da lista de testadores **aqui**, e nao no
 * provedor: a recusa da Meta chegaria depois de a tentativa ja ter sido gasta,
 * e tentativa recusada conta contra a reputacao do remetente.
 */
export function senderProblemFor(input: {
  providerId: string;
  sender: MessagingSender | null;
  channel: OutboundChannel;
  /** Destino ja normalizado. Ausente no planejamento, presente no envio. */
  destination?: string | null;
}): NotificationSkipReason | null {
  if (input.providerId === "SIMULATED") return null;

  const { sender } = input;
  if (!sender || sender.channel !== input.channel) return "SENDER_NOT_REGISTERED";
  if (sender.status !== "APPROVED") return "SENDER_NOT_APPROVED";
  if (sender.mode === "TEST" && input.destination && !sender.testRecipients.includes(input.destination)) {
    return "DESTINATION_NOT_IN_TEST_LIST";
  }
  return null;
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
  input: Pick<EligibilityInput, "organization" | "profession" | "client" | "sender">,
): NotificationSkipReason | null {
  const settings = input.organization.settings.notifications;

  // 1. O que a organizacao decidiu.
  if (!settings.enabled) return "ORGANIZATION_DISABLED";
  if (rule.event !== event) return "NO_RULE_FOR_EVENT";
  if (!rule.enabled) return "RULE_DISABLED";
  if (!settings.verifiedSenderChannels.includes(rule.channel)) {
    return "SENDER_NOT_VERIFIED";
  }
  const senderProblem = senderProblemFor({
    providerId: CHANNEL_META[rule.channel].providerId,
    sender: input.sender ?? null,
    channel: rule.channel,
  });
  if (senderProblem) return senderProblem;

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
  event: AgendaNoticeEvent,
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

// ------------------------------------------------- resposta na conversa

export interface ConversationReplyInput {
  organization: Organization;
  profession: ProfessionConfig;
  /** `null` quando o numero nao corresponde a um unico cadastro. */
  client: Client | null;
  sender?: MessagingSender | null;
  event: ConversationReplyEvent;
  stage: ReplyStage;
  /** Canal em que a pessoa escreveu. A resposta sai por ele, e so por ele. */
  channel: OutboundChannel;
  conversation: Pick<Conversation, "escalated" | "attention" | "inboundWindowEndsAt">;
  now: ISODateString;
  /**
   * Ate quando a resposta faz sentido. Na oferta, o fim da reserva: horarios
   * que ja nao estao segurados nao podem ser mostrados como livres.
   */
  validUntil?: ISODateString | null;
  /** Horarios da oferta ou horario novo da confirmacao. */
  details?: Pick<ReplyContext, "slots" | "startsAt">;
}

export type ConversationReplyEligibility =
  | { eligible: true; destination: string; contactHint: string; body: string }
  | { eligible: false; reason: NotificationSkipReason };

/**
 * A resposta da assistente a um pedido que a propria pessoa fez.
 *
 * Primeiro as MESMAS travas de qualquer aviso (`gateProblem`: organizacao,
 * regra, remetente, profissao, produto, consentimento e contato) — a resposta e
 * aviso, e a regra 11 nao tem excecao para ela. Depois o que so a conversa
 * sabe: se ha gente cuidando dela, se a janela aberta pela pessoa continua
 * aberta e se a resposta ainda vale. Chamada ao planejar e de novo ao enviar.
 */
export function evaluateConversationReply(
  input: ConversationReplyInput,
): ConversationReplyEligibility {
  const settings = input.organization.settings.notifications;
  if (!settings.enabled) return { eligible: false, reason: "ORGANIZATION_DISABLED" };

  const rule = settings.rules.find(
    (item) => item.event === input.event && item.channel === input.channel,
  );
  if (!rule) return { eligible: false, reason: "NO_RULE_FOR_EVENT" };
  if (!input.client) return { eligible: false, reason: "CLIENT_NOT_IDENTIFIED" };

  const problem = gateProblem(rule, input.event, {
    organization: input.organization,
    profession: input.profession,
    client: input.client,
    sender: input.sender,
  });
  if (problem) return { eligible: false, reason: problem };

  // Resposta nao tem planejamento adiantado: o destino e conhecido ja aqui, e a
  // lista de testadores do remetente e conferida contra ele.
  const contact = contactFor(input.client, input.channel);
  if (!contact) return { eligible: false, reason: "INVALID_CONTACT" };
  const restricted = senderProblemFor({
    providerId: CHANNEL_META[input.channel].providerId,
    sender: input.sender ?? null,
    channel: input.channel,
    destination: contact.destination,
  });
  if (restricted) return { eligible: false, reason: restricted };

  // Quem falou em risco, ou foi assumido pela equipe, nao recebe mensagem de
  // automacao — nem a de remarcacao que ele mesmo pediu depois.
  const { conversation } = input;
  if (conversation.escalated || conversation.attention === "CRITICAL") {
    return { eligible: false, reason: "CONVERSATION_WITH_HUMAN" };
  }
  const windowEndsAt = conversation.inboundWindowEndsAt;
  if (!windowEndsAt || Date.parse(input.now) > Date.parse(windowEndsAt)) {
    return { eligible: false, reason: "REPLY_WINDOW_CLOSED" };
  }
  if (input.validUntil && Date.parse(input.now) > Date.parse(input.validUntil)) {
    return { eligible: false, reason: "REPLY_EXPIRED" };
  }

  const rendered = renderReply(input.event, input.stage, {
    clientName: input.client.preferredName ?? firstName(input.client.fullName),
    organizationName: input.organization.name,
    ...input.details,
  });
  if (!rendered.ok) return { eligible: false, reason: "TEMPLATE_REJECTED" };

  return { eligible: true, destination: contact.destination, contactHint: contact.hint, body: rendered.value };
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
  /** Remetente cadastrado pela operadora para o canal (13.4). */
  sender?: MessagingSender | null;
}

export type SendCheck =
  | {
      ok: true;
      destination: string;
      body: string;
      /**
       * Modelo aprovado do WhatsApp, quando o canal e esse (13.4). `null` nos
       * demais canais — e tambem no WhatsApp enquanto o evento nao tiver
       * modelo, caso em que nada sai por falta de modelo, e nao por engano.
       */
      template: WhatsappMessage | null;
    }
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
  // Resposta na conversa nao se recompoe do atendimento: depende da conversa e
  // da reserva, e passa por `evaluateConversationReply`. Chegar aqui e engano.
  if (isConversationReplyEvent(delivery.event)) return stop("EVENT_WITHOUT_AUTOMATION");
  const event = delivery.event;

  const context: TemplateInput = {
    organization,
    profession: input.profession,
    appointment,
    client,
    professionalName: input.professionalName,
  };
  const problem = gateProblem(rule, event, { ...context, sender: input.sender ?? null });
  if (problem) return stop(problem);

  const contact = contactFor(client, rule.channel);
  if (!contact) return stop("INVALID_CONTACT");

  // So aqui existe destino: a lista de testadores do remetente e conferida
  // contra ele, e nao no planejamento, quando o contato ainda pode mudar.
  const restricted = senderProblemFor({
    providerId: CHANNEL_META[rule.channel].providerId,
    sender: input.sender ?? null,
    channel: rule.channel,
    destination: contact.destination,
  });
  if (restricted) return stop(restricted);

  const rendered = renderFor(rule, event, context);
  if (!rendered.ok) return stop("TEMPLATE_REJECTED");

  return {
    ok: true,
    destination: contact.destination,
    body: rendered.value,
    template: whatsappMessageFor({
      channel: rule.channel,
      event: delivery.event,
      disclosure: input.profession.notifications.disclosure,
      context: templateContext(context),
    }),
  };
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
