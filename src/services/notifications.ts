import { CHANNEL_META } from "@/config/notifications";
import { getProfession } from "@/config/professions";
import {
  consentProblemFor,
  contactFor,
  isDue,
  isExpired,
  isPending,
  planAppointmentNotifications,
  renderTemplate,
  templateContext,
  type DispatchTarget,
  type EligibilityInput,
  type NotificationPlan,
} from "@/lib/notifications";
import type {
  Appointment,
  AppointmentNotificationEvent,
  ID,
  ISODateString,
  NotificationDelivery,
} from "@/types";

import type { WorkspaceSnapshot } from "./types";

/**
 * Ponte entre a fotografia do tenant e o nucleo de avisos.
 *
 * Compartilhado pelos dois repositorios de proposito: se cada um decidisse
 * sozinho quando planejar e o que reenviar, "desligado por padrao" viraria duas
 * promessas diferentes — e a demonstracao poderia divergir do produto.
 *
 * Nada aqui grava. As funcoes recebem o snapshot e devolvem intencao.
 */

function eligibilityInput(
  snapshot: WorkspaceSnapshot,
  appointment: Appointment,
  event: AppointmentNotificationEvent,
  now: ISODateString,
): EligibilityInput | null {
  const client = snapshot.clients.find((item) => item.id === appointment.clientId);
  if (!client) return null;

  const professional = snapshot.professionals.find(
    (item) => item.id === appointment.professionalId,
  );

  return {
    organization: snapshot.organization,
    profession: getProfession(snapshot.organization.primaryProfession),
    appointment,
    client,
    professionalName: professional?.displayName ?? appointment.professionalName,
    event,
    now,
    existingDeliveryIds: snapshot.notificationDeliveries.map((item) => item.id),
  };
}

/**
 * O que um evento da agenda produz.
 *
 * Devolve plano vazio quando o cadastro do cliente nao esta no snapshot: sem
 * cadastro nao ha consentimento nem contato, e planejar seria inventar os dois.
 */
export function planForAppointmentEvent(
  snapshot: WorkspaceSnapshot,
  appointment: Appointment,
  event: AppointmentNotificationEvent,
  now: ISODateString,
): NotificationPlan {
  const input = eligibilityInput(snapshot, appointment, event, now);
  if (!input) return { planned: [], skipped: [] };
  return planAppointmentNotifications(input);
}

/**
 * Entregas ainda pendentes de um atendimento.
 *
 * Usado no cancelamento: um lembrete planejado para um atendimento que deixou de
 * existir precisa ser cancelado junto, ou a pessoa recebe lembrete de algo que
 * ja foi desmarcado.
 */
export function pendingDeliveriesFor(
  snapshot: WorkspaceSnapshot,
  appointmentId: ID,
): NotificationDelivery[] {
  return snapshot.notificationDeliveries.filter(
    (delivery) => delivery.appointmentId === appointmentId && isPending(delivery),
  );
}

/**
 * Recompoe destino e texto no momento do envio.
 *
 * O registro de entrega nao guarda nenhum dos dois. Recompor a partir do estado
 * atual e o que faz uma revogacao de consentimento, uma alteracao de contato ou
 * o desligamento do canal interromperem um envio JA planejado — e nao apenas os
 * proximos.
 */
export function dispatchTargetFor(
  snapshot: WorkspaceSnapshot,
  delivery: NotificationDelivery,
  now: ISODateString,
): DispatchTarget {
  const empty: DispatchTarget = { delivery, destination: null, body: null };

  const settings = snapshot.organization.settings.notifications;
  if (!settings.enabled) return empty;
  if (!settings.verifiedSenderChannels.includes(delivery.channel)) return empty;

  const rule = settings.rules.find((item) => item.id === delivery.ruleId);
  if (!rule?.enabled) return empty;

  const appointment = snapshot.appointments.find(
    (item) => item.id === delivery.appointmentId,
  );
  if (!appointment || appointment.status === "CANCELLED") return empty;

  const input = eligibilityInput(snapshot, appointment, delivery.event, now);
  if (!input) return empty;
  if (consentProblemFor(input.client, delivery.channel)) return empty;

  const contact = contactFor(input.client, delivery.channel);
  if (!contact) return empty;

  const profession = input.profession.notifications;
  const rendered = renderTemplate(
    rule.customTemplate ?? profession.templates[delivery.event],
    templateContext(input),
    {
      disclosure: profession.disclosure,
      maxBodyLength: CHANNEL_META[delivery.channel].maxBodyLength,
    },
  );
  if (!rendered.ok) return empty;

  return { delivery, destination: contact.destination, body: rendered.value };
}

/** Entregas que o disparo deve considerar: vencidas ou ja passadas da janela. */
export function dueDeliveries(
  snapshot: WorkspaceSnapshot,
  now: ISODateString,
): NotificationDelivery[] {
  return snapshot.notificationDeliveries.filter(
    (delivery) => isDue(delivery, now) || isExpired(delivery, now),
  );
}
