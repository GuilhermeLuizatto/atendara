import type { Client, ID } from "@/types";

import { assertConsentWrite, assertPermission } from "../../guards";
import { RepositoryError, type ClientInput } from "../../types";
import {
  auditWrite,
  docPath,
  notificationWrite,
  requireClient,
  stamp,
  touch,
  type Plan,
  type PlanContext,
  type WriteOperation,
} from "../plan";

/** Cadastro administrativo. Nao ha dado clinico nesta colecao. */
export function planCreateClient(
  ctx: PlanContext,
  input: ClientInput,
): Plan<ID> {
  assertPermission(ctx.actor, "client:create");
  const consent = assertConsentWrite(ctx.actor, null, input.notificationConsent);
  const id = ctx.newId("clients");

  const client: Client = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    ...input,
    // Campos derivados nascem zerados e sao recalculados na leitura do
    // snapshot; ver `snapshot.ts`.
    lastAppointmentAt: null,
    nextAppointmentAt: null,
    totalAppointments: 0,
    outstandingBalanceInCents: 0,
  };

  return {
    result: id,
    writes: [
      {
        op: "set",
        collection: "clients",
        path: docPath(ctx, "clients", id),
        data: client as unknown as Record<string, unknown>,
      },
      notificationWrite(ctx, {
        type: "NEW_CLIENT",
        priority: "NORMAL",
        title: "Novo cadastro",
        body: `${client.fullName} foi cadastrado.`,
        professionalId: client.assignedProfessionalId,
        target: { type: "client", id },
        aiDecisionId: null,
      }).write,
      auditWrite(ctx, {
        action: "CREATE",
        actorType: "USER",
        resource: { type: "client", id },
        summary: `Cadastro de ${client.fullName} criado.`,
        metadata: { status: client.status, ...(consent ? { consent } : {}) },
      }),
    ],
  };
}

export function planUpdateClient(
  ctx: PlanContext,
  id: ID,
  input: Partial<ClientInput>,
): Plan {
  assertPermission(ctx.actor, "client:update");
  const existing = requireClient(ctx, id);
  const consent = assertConsentWrite(ctx.actor, existing.notificationConsent, input.notificationConsent);
  const fullName = input.fullName ?? existing.fullName;

  const writes: WriteOperation[] = [
    {
      op: "update",
      collection: "clients",
      path: docPath(ctx, "clients", id),
      data: { ...input, ...touch(ctx) },
    },
  ];

  // O nome desnormalizado precisa acompanhar; caso contrario a agenda e a
  // caixa de entrada continuariam exibindo o nome antigo.
  if (fullName !== existing.fullName) {
    for (const appointment of ctx.snapshot.appointments) {
      if (appointment.clientId !== id) continue;
      writes.push({
        op: "update",
        collection: "appointments",
        path: docPath(ctx, "appointments", appointment.id),
        data: { clientName: fullName, ...touch(ctx) },
      });
    }
    for (const conversation of ctx.snapshot.conversations) {
      if (conversation.clientId !== id) continue;
      writes.push({
        op: "update",
        collection: "conversations",
        path: docPath(ctx, "conversations", conversation.id),
        data: { clientName: fullName, ...touch(ctx) },
      });
    }
  }

  writes.push(
    auditWrite(ctx, {
      action: "UPDATE",
      actorType: "USER",
      resource: { type: "client", id },
      summary: `Cadastro de ${fullName} atualizado.`,
      metadata: { fields: Object.keys(input).join(", "), ...(consent ? { consent } : {}) },
    }),
  );

  return { result: undefined, writes };
}

export function planDeleteClient(ctx: PlanContext, id: ID): Plan {
  assertPermission(ctx.actor, "client:delete");
  const existing = requireClient(ctx, id);

  // Excluir alguem com agenda futura apagaria compromissos silenciosamente.
  const future = ctx.snapshot.appointments.filter(
    (appointment) =>
      appointment.clientId === id &&
      appointment.startsAt > ctx.now &&
      appointment.status !== "CANCELLED",
  );
  if (future.length > 0) {
    throw new RepositoryError(
      `Existem ${future.length} atendimento(s) futuros. Cancele-os antes de excluir.`,
    );
  }

  const open = ctx.snapshot.transactions.filter(
    (transaction) =>
      transaction.clientId === id &&
      (transaction.status === "PENDING" || transaction.status === "OVERDUE"),
  );
  if (open.length > 0) {
    throw new RepositoryError(
      "Há pendências financeiras em aberto para este cadastro.",
    );
  }

  return {
    result: undefined,
    writes: [
      { op: "delete", path: docPath(ctx, "clients", id) },
      auditWrite(ctx, {
        action: "DELETE",
        actorType: "USER",
        resource: { type: "client", id },
        summary: `Cadastro de ${existing.fullName} excluído.`,
      }),
    ],
  };
}
