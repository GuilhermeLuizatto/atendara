import { DEPOSIT_DESCRIPTION_PREFIX, type DepositChoice } from "@/config/deposit";
import { HOME_VISIT_ERRORS, TRAVEL_DESCRIPTION_PREFIX } from "@/config/home-visit";
import { getProfession } from "@/config/professions";
import { validateHomeVisit } from "@/lib/agenda/home-visit";
import { amountForPart, partOf } from "@/lib/agenda/charges";
import {
  depositDueDate,
  serviceAmountFor,
  settleDeposit,
  validateDeposit,
} from "@/lib/agenda/deposit";
import { addMinutesISO } from "@/lib/utils/datetime";
import type { Appointment, AppointmentPart, AppointmentStatus, ID, Transaction } from "@/types";

import { assertPermission } from "../../guards";
import { findConflict } from "../../aggregates";
import { RepositoryError, type AppointmentInput } from "../../types";
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
 *
 * Avisos ao cliente nao saem destes planos. O gatilho `planAppointmentNotices`
 * do backend le cada escrita de atendimento e planeja, cancela ou replaneja a
 * fila — o navegador nao escreve em `notificationDeliveries` nem em
 * `automationTasks`.
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
    throw new RepositoryError(`Conflito de horário com ${conflict.clientName}.`);
  }
}

/** Sinal so existe onde a profissao trabalha com sinal (E2.2). */
function depositOf(ctx: PlanContext, raw: number | null, priceInCents: number): number | null {
  const validation = validateDeposit({
    depositInCents: raw,
    priceInCents,
    // A profissao da organizacao decide, nunca um `if` por nome (regra 1).
    available: getProfession(ctx.snapshot.organization.primaryProfession).features.depositOnBooking,
  });
  if (!validation.ok) throw new RepositoryError(validation.error);
  return validation.value;
}

function incomeWrite(
  ctx: PlanContext,
  input: {
    appointmentId: ID;
    part: AppointmentPart;
    amountInCents: number;
    dueDate: string;
    description: string;
    client: { id: ID; fullName: string };
    professionalId: ID;
  },
): WriteOperation {
  const id = ctx.newId("transactions");
  const transaction: Transaction = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    type: "INCOME",
    clientId: input.client.id,
    clientName: input.client.fullName,
    professionalId: input.professionalId,
    appointmentId: input.appointmentId,
    appointmentPart: input.part,
    description: input.description,
    amountInCents: input.amountInCents,
    status: "PENDING",
    method: null,
    dueDate: input.dueDate,
    paidAt: null,
    gateway: null,
  };
  return {
    op: "set",
    collection: "transactions",
    path: docPath(ctx, "transactions", id),
    data: transaction as unknown as Record<string, unknown>,
  };
}

/** Endereco e taxa so onde a profissao registra domicilio (E2.3). */
function homeVisitOf(
  ctx: PlanContext,
  input: { modality: Appointment["modality"]; visitAddress: string | null; travelFeeInCents: number | null },
) {
  const validation = validateHomeVisit({
    ...input,
    available: getProfession(ctx.snapshot.organization.primaryProfession).features.homeVisitDetails,
  });
  if (!validation.ok) throw new RepositoryError(validation.error);
  return validation.value;
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

  const deposit = depositOf(ctx, input.depositInCents ?? null, input.priceInCents);
  const visita = homeVisitOf(ctx, {
    modality: input.modality,
    visitAddress: input.visitAddress ?? null,
    travelFeeInCents: input.travelFeeInCents ?? null,
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
    serviceId: input.serviceId ?? null,
    serviceName: input.serviceName ?? null,
    modality: input.modality,
    status: input.status,
    priceInCents: input.priceInCents,
    depositInCents: deposit,
    depositOutcome: null,
    ...visita,
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
  //
  // Com sinal sao DOIS lancamentos: o sinal, que vence na marcacao, e o que
  // fica a pagar, que vence no atendimento. Somados dao o valor cobrado.
  const comum = { appointmentId: id, client, professionalId: professional.id };
  const aPagar = serviceAmountFor(appointment.priceInCents, deposit);
  if (aPagar > 0) {
    writes.push(
      incomeWrite(ctx, {
        ...comum,
        part: "SERVICE",
        amountInCents: aPagar,
        dueDate: appointment.startsAt,
        description: `Atendimento de ${client.fullName}`,
      }),
    );
  }
  if (visita.travelFeeInCents !== null) {
    writes.push(
      incomeWrite(ctx, {
        ...comum,
        part: "TRAVEL",
        amountInCents: visita.travelFeeInCents,
        dueDate: appointment.startsAt,
        description: `${TRAVEL_DESCRIPTION_PREFIX} — ${client.fullName}`,
      }),
    );
  }
  if (deposit !== null) {
    writes.push(
      incomeWrite(ctx, {
        ...comum,
        part: "DEPOSIT",
        amountInCents: deposit,
        // O sinal e antecipado: vence antes do atendimento, nao no dia dele.
        dueDate: depositDueDate(ctx.now, appointment.startsAt),
        description: `${DEPOSIT_DESCRIPTION_PREFIX} — ${client.fullName}`,
      }),
    );
  }

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
  const deposit =
    input.depositInCents === undefined
      ? existing.depositInCents
      : depositOf(ctx, input.depositInCents, priceInCents);

  const modality = input.modality ?? existing.modality;
  const visita = homeVisitOf(ctx, {
    modality,
    visitAddress: input.visitAddress === undefined ? existing.visitAddress : input.visitAddress,
    travelFeeInCents:
      input.travelFeeInCents === undefined ? existing.travelFeeInCents : input.travelFeeInCents,
  });

  const ligados = ctx.snapshot.transactions.filter((item) => item.appointmentId === id);
  const sinalPago = ligados.some((item) => partOf(item) === "DEPOSIT" && item.status === "PAID");
  if (sinalPago && deposit !== existing.depositInCents) {
    throw new RepositoryError(
      "O sinal já foi pago. Devolva o sinal pelo cancelamento antes de mudar o valor.",
    );
  }

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
        depositInCents: deposit,
        ...visita,
        professionalId,
        professionalName: professional.displayName,
        clientId: client?.id ?? existing.clientId,
        clientName,
        ...touch(ctx),
      },
    },
  ];

  // Os lancamentos vinculados acompanham valor e vencimento do atendimento.
  // O do servico e o que sobra depois do sinal; o do sinal e o sinal.
  const charges = {
    serviceInCents: serviceAmountFor(priceInCents, deposit),
    depositInCents: deposit,
    travelFeeInCents: visita.travelFeeInCents,
  };
  const existentes = new Set(ligados.map((transaction) => partOf(transaction)));

  for (const transaction of ligados) {
    if (transaction.status === "PAID") continue;
    const parte = partOf(transaction);
    const valor = amountForPart(parte, charges);

    // Cobranca que deixou de existir vira cancelada, e nao some: a trilha do
    // financeiro nao apaga linha.
    writes.push({
      op: "update",
      collection: "transactions",
      path: docPath(ctx, "transactions", transaction.id),
      data:
        valor === null
          ? { status: "CANCELLED", clientName, ...touch(ctx) }
          : {
              amountInCents: valor,
              // O sinal tem prazo proprio; o resto vence no atendimento.
              dueDate: parte === "DEPOSIT" ? transaction.dueDate : startsAt,
              clientName,
              ...touch(ctx),
            },
    });
  }

  // Sinal ou deslocamento pedidos depois da marcacao precisam nascer agora.
  if (client) {
    if (deposit !== null && !existentes.has("DEPOSIT")) {
      writes.push(
        incomeWrite(ctx, {
          appointmentId: id,
          client,
          professionalId,
          part: "DEPOSIT",
          amountInCents: deposit,
          dueDate: depositDueDate(ctx.now, startsAt),
          description: `${DEPOSIT_DESCRIPTION_PREFIX} — ${clientName}`,
        }),
      );
    }
    if (visita.travelFeeInCents !== null && !existentes.has("TRAVEL")) {
      writes.push(
        incomeWrite(ctx, {
          appointmentId: id,
          client,
          professionalId,
          part: "TRAVEL",
          amountInCents: visita.travelFeeInCents,
          dueDate: startsAt,
          description: `${TRAVEL_DESCRIPTION_PREFIX} — ${clientName}`,
        }),
      );
    }
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
  choice?: DepositChoice | null,
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

  const ligados = ctx.snapshot.transactions.filter((item) => item.appointmentId === id);
  const lancamentoDoSinal = ligados.find((item) => partOf(item) === "DEPOSIT");
  const destino = settleDeposit({
    status,
    hasDeposit: existing.depositInCents !== null,
    depositPaid: lancamentoDoSinal?.status === "PAID",
    choice: choice ?? null,
  });

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
        depositOutcome: destino.outcome ?? existing.depositOutcome,
        ...touch(ctx),
      },
    },
  ];

  // Cancelamento nao cobra: o que ficou a pagar e cancelado junto. O sinal
  // segue o que `settleDeposit` decidiu — reter, devolver ou cair.
  for (const transaction of ligados) {
    const parte = partOf(transaction);
    const acao = parte === "DEPOSIT" ? destino.deposit : destino.service;
    if (acao === "UNCHANGED" || acao === "KEEP_PAID") continue;
    if (acao === "CANCEL" && transaction.status === "PAID") continue;

    writes.push({
      op: "update",
      collection: "transactions",
      path: docPath(ctx, "transactions", transaction.id),
      data: {
        status: acao === "REFUND" ? "REFUNDED" : "CANCELLED",
        ...touch(ctx),
      },
    });
  }

  if (status === "CANCELLED") {
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

  writes.push(
    auditWrite(ctx, {
      action: "UPDATE",
      actorType: "USER",
      resource: { type: "appointment", id },
      summary: `Atendimento de ${existing.clientName}: ${status}.`,
      // O destino do sinal entra na trilha: e dinheiro da cliente mudando de
      // lugar, e depois alguem vai perguntar quem decidiu o que.
      metadata: destino.outcome ? { status, deposit: destino.outcome } : { status },
    }),
  );

  return { result: undefined, writes };
}
