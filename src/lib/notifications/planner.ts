import { CHANNEL_META } from "@/config/notifications";
import type {
  AppointmentNotificationEvent,
  ID,
  ISODateString,
  NotificationDelivery,
  NotificationSkipReason,
  OutboundChannel,
} from "@/types";

import { contactFor } from "./contacts";
import { deliveryKey } from "./delivery";
import { evaluateRule, type EligibilityInput } from "./eligibility";
import { hashBody } from "./templates";

/**
 * De um evento da agenda para uma lista de envios planejados.
 *
 * O caso normal e a lista vazia: uma organizacao que nao configurou nada produz
 * zero envios e uma lista de motivos. Confirmar um atendimento passa por aqui
 * como qualquer outro evento e sai sem nada planejado enquanto faltar uma das
 * condicoes de `evaluateRule`.
 *
 * A funcao e pura: nao grava, nao envia e nao le relogio proprio. Quem chama
 * decide o que fazer com o plano — o repositorio grava, o simulador so mostra.
 */

export interface PlannedDelivery {
  /** Derivado do conteudo do envio; ver `deliveryKey`. */
  id: ID;
  ruleId: ID;
  event: AppointmentNotificationEvent;
  channel: OutboundChannel;
  appointmentId: ID;
  clientId: ID;
  professionalId: ID | null;
  scheduledFor: ISODateString;
  /** Texto ja renderizado. NAO e gravado: so o hash e o tamanho vao ao registro. */
  body: string;
  bodyHash: string;
  bodyLength: number;
  destination: string;
  contactHint: string;
  templateId: string;
  providerId: string;
}

export interface SkippedDelivery {
  ruleId: ID | null;
  channel: OutboundChannel | null;
  reason: NotificationSkipReason;
}

export interface NotificationPlan {
  planned: PlannedDelivery[];
  skipped: SkippedDelivery[];
}

export function planAppointmentNotifications(
  input: EligibilityInput,
): NotificationPlan {
  const settings = input.organization.settings.notifications;
  const planned: PlannedDelivery[] = [];
  const skipped: SkippedDelivery[] = [];

  const rules = settings.rules.filter((rule) => rule.event === input.event);
  if (rules.length === 0) {
    return {
      planned,
      skipped: [
        {
          ruleId: null,
          channel: null,
          reason: settings.enabled
            ? "NO_RULE_FOR_EVENT"
            : "ORGANIZATION_DISABLED",
        },
      ],
    };
  }

  // Os ids ja planejados nesta mesma passagem entram na conferencia: duas
  // regras iguais para o mesmo par evento+canal produziriam duas mensagens
  // identicas para a mesma pessoa.
  const seen = new Set<ID>(input.existingDeliveryIds);

  for (const rule of rules) {
    const decision = evaluateRule(rule, {
      ...input,
      existingDeliveryIds: [...seen],
    });

    if (!decision.eligible) {
      skipped.push({ ruleId: rule.id, channel: rule.channel, reason: decision.reason });
      continue;
    }

    const contact = contactFor(input.client, rule.channel);
    if (!contact) {
      skipped.push({ ruleId: rule.id, channel: rule.channel, reason: "INVALID_CONTACT" });
      continue;
    }

    const id = deliveryKey({
      appointmentId: input.appointment.id,
      event: input.event,
      channel: rule.channel,
      scheduledFor: decision.scheduledFor,
    });
    seen.add(id);

    planned.push({
      id,
      ruleId: rule.id,
      event: input.event,
      channel: rule.channel,
      appointmentId: input.appointment.id,
      clientId: input.client.id,
      professionalId: input.appointment.professionalId,
      scheduledFor: decision.scheduledFor,
      body: decision.body,
      bodyHash: hashBody(decision.body),
      bodyLength: decision.body.length,
      destination: contact.destination,
      contactHint: contact.hint,
      templateId: rule.customTemplate ? `custom:${rule.id}` : `profession:${input.profession.id}:${input.event}`,
      providerId: CHANNEL_META[rule.channel].providerId,
    });
  }

  return { planned, skipped };
}

/**
 * Registro de entrega a partir do plano.
 *
 * O que NAO e copiado do plano e o ponto: `body` e `destination` ficam de fora.
 * O registro guarda hash, tamanho e as ultimas posicoes do contato — suficiente
 * para auditar o envio, insuficiente para reconstruir a mensagem ou a agenda de
 * contatos de quem e atendido.
 */
export function toDeliveryDocument(
  plan: PlannedDelivery,
  organizationId: ID,
  now: ISODateString,
  actorId: ID | null,
): NotificationDelivery {
  return {
    id: plan.id,
    organizationId,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    audience: "ORGANIZATION_TO_CLIENT",
    event: plan.event,
    channel: plan.channel,
    ruleId: plan.ruleId,
    appointmentId: plan.appointmentId,
    clientId: plan.clientId,
    professionalId: plan.professionalId,
    scheduledFor: plan.scheduledFor,
    status: "PLANNED",
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    providerId: plan.providerId,
    providerMessageId: null,
    failureCode: null,
    templateId: plan.templateId,
    bodyHash: plan.bodyHash,
    bodyLength: plan.bodyLength,
    contactHint: plan.contactHint,
    sentAt: null,
    cancelledAt: null,
  };
}
