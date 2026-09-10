import { addMinutesISO } from "@/lib/utils/datetime";
import type { Appointment, AppointmentStatus, ID, Transaction } from "@/types";

import { assertPermission } from "../../guards";
import { findConflict } from "../../aggregates";
import { RepositoryError, type AppointmentInput } from "../../types";
import {
  cancelPendingDeliveryWrites,
  notificationWrites,
} from "./outbound";
import {
  auditWrite,
  docPath,
  notificationWrite,
  requireAppointment,
  requireClient,
  requireProfessional,
  stamp,
  touch,
  type Plan,
  type PlanContext,
  type WriteOperation,
} from "../plan";

/**
 * Conflito de horario e conferido contra o ultimo snapshot conhecido — o mesmo
 * que a versao em memoria faz. A checagem definitiva pertence ao servidor:
 * o SDK cliente nao consulta por query dentro de uma transacao, entao duas
 * marcacoes simultaneas no mesmo minuto ainda passam. Enquanto isso nao vira
 * Cloud Function, `allowDoubleBooking` continua sendo a valvula do usuario.
 */
function assertNoConflict(
  ctx: PlanContext,
  candidate: {
    id?: ID;
    professionalId: ID;
    startsAt: string;
    endsAt: string;
  },
): void {
  const conflict = findConflict(ctx.snapshot.appointments, candidate);
  if (conflict && !ctx.snapshot.organization.settings.agenda.allowDoubleBooking) {
    throw new RepositoryError(`Conflito de horario com ${conflict.clientName}.`);
  }
}

export function planCreateAppointment(
  ctx: PlanContext,
  input: AppointmentInput,
): Plan<ID> {
  assertPermission(ctx.actor, "appointment:create");
  const client = requireClient(ctx, input.clientId);
  const professional = requireProfessional(ctx, input.professionalId);
  const endsAt = addMinutesISO(input.startsAt, input.durationMinutes);

  assertNoConflict(ctx, {
    professionalId: input.professionalId,
    startsAt: input.startsAt,
    endsAt,
  });

  const id = ctx.newId("appointments");
  const appointment: Appointment = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    clientId: client.id,
    clientName: client.fullName,
    professionalId: professional.id,
    professionalName: professional.displayName,
    startsAt: input.startsAt,
    endsAt,
    durationMinutes: input.durationMinutes,
    modality: input.modality,
    status: input.status,
    priceInCents: input.priceInCents,
    administrativeNotes: input.administrativeNotes,
    origin: "MANUAL",
    confirmedAt: input.status === "CONFIRMED" ? ctx.now : null,
    cancelledAt: null,
    cancellationReason: null,
    rescheduledFromId: null,
    externalCalendar: null,
  };

  const writes: WriteOperation[] = [
    {
      op: "set",
      collection: "appointments",
      path: docPath(ctx, "appointments", id),
      data: appointment as unknown as Record<string, unknown>,
    },
  ];

  // Todo atendimento cobrado gera a receita correspondente. E o que mantem o
  // financeiro coerente com a agenda sem lancamento manual duplicado.
  if (appointment.priceInCents > 0) {
    const transactionId = ctx.newId("transactions");
    const transaction: Transaction = {
      id: transactionId,
      organizationId: ctx.organizationId,
      ...stamp(ctx),
      type: "INCOME",
      clientId: client.id,
      clientName: client.fullName,
      professionalId: professional.id,
      appointmentId: id,
      description: `Atendimento de ${client.fullName}`,
      amountInCents: appointment.priceInCents,
      status: "PENDING",
      method: null,
      dueDate: appointment.startsAt,
      paidAt: null,
      gateway: null,
    };
    writes.push({
      op: "set",
      collection: "transactions",
      path: docPath(ctx, "transactions", transactionId),
      data: transaction as unknown as Record<string, unknown>,
    });
  }

  // Avisos ao cliente. Lista vazia enquanto a organizacao nao tiver ligado
  // canal, evento, antecedencia e modelo — que e o padrao.
  const withAppointment = {
    ...ctx,
    snapshot: {
      ...ctx.snapshot,
      appointments: [...ctx.snapshot.appointments, appointment],
    },
  };
  writes.push(
    ...notificationWrites(withAppointment, appointment, "APPOINTMENT_SCHEDULED"),
    ...notificationWrites(withAppointment, appointment, "APPOINTMENT_REMINDER"),
  );

  writes.push(
    auditWrite(ctx, {
      action: "CREATE",
      actorType: "USER",
      resource: { type: "appointment", id },
      summary: `Atendimento de ${client.fullName} agendado.`,
      metadata: { startsAt: appointment.startsAt },
    }),
  );

  return { result: id, writes };
}

export function planUpdateAppointment(
  ctx: PlanContext,
  id: ID,
  input: Partial<AppointmentInput>,
): Plan {
  assertPermission(ctx.actor, "appointment:update");
  const existing = requireAppointment(ctx, id);

  const startsAt = input.startsAt ?? existing.startsAt;
  const durationMinutes = input.durationMinutes ?? existing.durationMinutes;
  const professionalId = input.professionalId ?? existing.professionalId;
  const endsAt = addMinutesISO(startsAt, durationMinutes);

  assertNoConflict(ctx, { id, professionalId, startsAt, endsAt });

  const client = input.clientId
    ? requireClient(ctx, input.clientId)
    : ctx.snapshot.clients.find((item) => item.id === existing.clientId);
  const professional = requireProfessional(ctx, professionalId);

  const clientName = client?.fullName ?? existing.clientName;
  const priceInCents = input.priceInCents ?? existing.priceInCents;

  const writes: WriteOperation[] = [
    {
      op: "update",
      collection: "appointments",
      path: docPath(ctx, "appointments", id),
      data: {
        ...input,
        startsAt,
        endsAt,
        durationMinutes,
        professionalId,
        professionalName: professional.displayName,
        clientId: client?.id ?? existing.clientId,
        clientName,
        ...touch(ctx),
      },
    },
  ];

  // A receita vinculada acompanha valor e vencimento do atendimento.
  for (const transaction of ctx.snapshot.transactions) {
    if (transaction.appointmentId !== id || transaction.status === "PAID") {
      continue;
    }
    writes.push({
      op: "update",
      collection: "transactions",
      path: docPath(ctx, "transactions", transaction.id),
      data: {
        amountInCents: priceInCents,
        dueDate: startsAt,
        clientName,
        ...touch(ctx),
      },
    });
  }

  // Remarcar muda o instante do lembrete, e a chave do envio deriva dele: o
  // que estava planejado para o horario antigo e cancelado, e o novo entra.
  if (startsAt !== existing.startsAt) {
    const updated = { ...existing, startsAt, endsAt, professionalId };
    writes.push(
      ...cancelPendingDeliveryWrites(ctx, id),
      ...notificationWrites(
        {
          ...ctx,
          snapshot: {
            ...ctx.snapshot,
            appointments: ctx.snapshot.appointments.map((item) =>
              item.id === id ? updated : item,
            ),
          },
        },
        updated,
        "APPOINTMENT_REMINDER",
      ),
    );
  }

  writes.push(
    auditWrite(ctx, {
      action: "UPDATE",
      actorType: "USER",
      resource: { type: "appointment", id },
      summary: `Atendimento de ${clientName} atualizado.`,
      metadata: { startsAt },
    }),
  );

  return { result: undefined, writes };
}

export function planSetAppointmentStatus(
  ctx: PlanContext,
  id: ID,
  status: AppointmentStatus,
  reason?: string,
): Plan {
  assertPermission(
    ctx.actor,
    status === "CANCELLED" ? "appointment:cancel" : "appointment:update",
  );
  const existing = requireAppointment(ctx, id);

  const cancellationReason =
    status === "CANCELLED"
      ? (reason ?? "Cancelado pelo profissional.")
      : existing.cancellationReason;

  const writes: WriteOperation[] = [
    {
      op: "update",
      collection: "appointments",
      path: docPath(ctx, "appointments", id),
      data: {
        status,
        confirmedAt: status === "CONFIRMED" ? ctx.now : existing.confirmedAt,
        cancelledAt: status === "CANCELLED" ? ctx.now : existing.cancelledAt,
        cancellationReason,
        ...touch(ctx),
      },
    },
  ];

  if (status === "CANCELLED") {
    // Cancelamento nao cobra: a receita pendente e cancelada junto.
    for (const transaction of ctx.snapshot.transactions) {
      if (transaction.appointmentId !== id || transaction.status === "PAID") {
        continue;
      }
      writes.push({
        op: "update",
        collection: "transactions",
        path: docPath(ctx, "transactions", transaction.id),
        data: { status: "CANCELLED", ...touch(ctx) },
      });
    }

    writes.push(
      notificationWrite(ctx, {
        type: "APPOINTMENT_CANCELLED",
        priority: "ATTENTION",
        title: `Atendimento cancelado: ${existing.clientName}`,
        body: cancellationReason ?? "Cancelado.",
        professionalId: existing.professionalId,
        target: { type: "appointment", id },
        aiDecisionId: null,
      }).write,
    );
  }

  // Confirmar e cancelar passam pelo portao como qualquer outro evento. Sem
  // regra habilitada para o evento, `notificationWrites` devolve lista vazia —
  // e a mudanca de estado continua sendo so uma mudanca de estado.
  if (status === "CONFIRMED") {
    writes.push(...notificationWrites(ctx, existing, "APPOINTMENT_CONFIRMED"));
  }

  if (status === "CANCELLED" || status === "NO_SHOW") {
    // O atendimento deixou de valer: o que ainda nao saiu nao deve sair.
    writes.push(...cancelPendingDeliveryWrites(ctx, id));
    if (status === "CANCELLED") {
      writes.push(...notificationWrites(ctx, existing, "APPOINTMENT_CANCELLED"));
    }
  }

  writes.push(
    auditWrite(ctx, {
      action: "UPDATE",
      actorType: "USER",
      resource: { type: "appointment", id },
      summary: `Atendimento de ${existing.clientName}: ${status}.`,
      metadata: { status },
    }),
  );

  return { result: undefined, writes };
}
