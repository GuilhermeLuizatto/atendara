import { toDeliveryDocument, type DeliveryTransition } from "@/lib/notifications";
import type {
  Appointment,
  AppointmentNotificationEvent,
  ID,
  NotificationDelivery,
  OrganizationNotificationSettings,
} from "@/types";

import { assertPermission } from "../../guards";
import {
  planForAppointmentEvent,
  pendingDeliveriesFor,
} from "../../notifications";
import { paths } from "@/lib/firebase/paths";
import {
  auditWrite,
  docPath,
  touch,
  type Plan,
  type PlanContext,
  type WriteOperation,
} from "../plan";

/**
 * Escritas dos avisos ao cliente.
 *
 * A fila de saida e append-ish: o documento nasce `PLANNED` com id derivado do
 * proprio envio e depois so muda de estado. Replanejar o mesmo aviso escreve no
 * mesmo documento em vez de criar um segundo — a duplicidade e impedida pelo
 * formato do id, nao por uma conferencia que alguem pode esquecer.
 */

/**
 * O que um evento da agenda acrescenta ao plano de escrita.
 *
 * Devolve lista vazia no caso normal. Uma organizacao que nao configurou nada —
 * o padrao — faz confirmar, agendar e cancelar continuarem sendo apenas
 * alteracoes do atendimento.
 */
export function notificationWrites(
  ctx: PlanContext,
  appointment: Appointment,
  event: AppointmentNotificationEvent,
): WriteOperation[] {
  const plan = planForAppointmentEvent(ctx.snapshot, appointment, event, ctx.now);

  return plan.planned.map((planned) => ({
    op: "set" as const,
    collection: "notificationDeliveries" as const,
    path: docPath(ctx, "notificationDeliveries", planned.id),
    data: toDeliveryDocument(
      planned,
      ctx.organizationId,
      ctx.now,
      ctx.actor.userId,
    ) as unknown as Record<string, unknown>,
  }));
}

/**
 * Cancela o que ainda nao saiu para um atendimento.
 *
 * Sem isto, cancelar um atendimento deixaria de pe o lembrete ja planejado — e a
 * pessoa receberia lembrete de algo desmarcado, que e pior do que nao receber
 * nada.
 */
export function cancelPendingDeliveryWrites(
  ctx: PlanContext,
  appointmentId: ID,
): WriteOperation[] {
  return pendingDeliveriesFor(ctx.snapshot, appointmentId).map((delivery) => ({
    op: "update" as const,
    collection: "notificationDeliveries" as const,
    path: docPath(ctx, "notificationDeliveries", delivery.id),
    data: {
      status: "CANCELLED",
      cancelledAt: ctx.now,
      nextAttemptAt: null,
      ...touch(ctx),
    },
  }));
}

export function deliveryTransitionWrite(
  ctx: PlanContext,
  delivery: NotificationDelivery,
  transition: DeliveryTransition,
): WriteOperation {
  return {
    op: "update",
    collection: "notificationDeliveries",
    path: docPath(ctx, "notificationDeliveries", delivery.id),
    data: { ...transition, ...touch(ctx) },
  };
}

export function deliveryCancelWrite(
  ctx: PlanContext,
  delivery: NotificationDelivery,
): WriteOperation {
  return {
    op: "update",
    collection: "notificationDeliveries",
    path: docPath(ctx, "notificationDeliveries", delivery.id),
    data: {
      status: "CANCELLED",
      cancelledAt: ctx.now,
      nextAttemptAt: null,
      ...touch(ctx),
    },
  };
}

/**
 * Alterar a configuracao de avisos e ato administrativo, e por isso exige
 * `organization:update` e deixa rastro na trilha. O resumo registra o que mudou
 * sem copiar modelo nenhum: o texto vive na configuracao, nao na auditoria.
 */
export function planUpdateNotificationSettings(
  ctx: PlanContext,
  settings: OrganizationNotificationSettings,
): Plan {
  assertPermission(ctx.actor, "organization:update");

  const enabledRules = settings.rules.filter((rule) => rule.enabled).length;

  return {
    result: undefined,
    writes: [
      {
        op: "update",
        collection: "organizations",
        path: paths.organization(ctx.organizationId),
        data: {
          "settings.notifications": settings,
          ...touch(ctx),
        },
      },
      auditWrite(ctx, {
        action: "UPDATE",
        actorType: "USER",
        resource: { type: "organization", id: ctx.organizationId },
        summary: settings.enabled
          ? `Avisos de atendimento ativados com ${enabledRules} regra(s).`
          : "Avisos de atendimento desativados.",
        metadata: {
          enabled: settings.enabled,
          channels: settings.verifiedSenderChannels.join(",") || "nenhum",
          enabledRules,
        },
      }),
    ],
  };
}
