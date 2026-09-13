import { getProfession } from "@/config/professions";
import {
  composeForSend,
  isDue,
  isExpired,
  isPending,
  planAppointmentNotifications,
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
 * Usada pela demonstracao em memoria, que planeja e simula a fila no proprio
 * navegador. No Firestore quem planeja e dispara e o backend
 * (`functions/automation.js`), com as mesmas funcoes de `src/lib`: se cada lado
 * decidisse sozinho, "desligado por padrao" viraria duas promessas diferentes.
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
 * Destino e texto recompostos do estado atual, pelas travas de
 * `composeForSend` — as mesmas que o despachante do backend confere. A
 * comparacao do texto com o planejado fica em `dispatchDelivery`.
 */
export function dispatchTargetFor(
  snapshot: WorkspaceSnapshot,
  delivery: NotificationDelivery,
): DispatchTarget {
  const appointment =
    snapshot.appointments.find((item) => item.id === delivery.appointmentId) ?? null;
  const client = appointment
    ? (snapshot.clients.find((item) => item.id === appointment.clientId) ?? null)
    : null;
  const professional = appointment
    ? snapshot.professionals.find((item) => item.id === appointment.professionalId)
    : undefined;

  const check = composeForSend({
    organization: snapshot.organization,
    profession: getProfession(snapshot.organization.primaryProfession),
    appointment,
    client,
    professionalName: professional?.displayName ?? appointment?.professionalName ?? null,
    delivery,
    plannedForStartsAt: null,
  });

  return check.ok
    ? { delivery, destination: check.destination, body: check.body }
    : { delivery, destination: null, body: null };
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
