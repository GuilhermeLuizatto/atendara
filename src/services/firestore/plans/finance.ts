import type { ID, Transaction } from "@/types";

import {
  assertClientProfessionalAssignment,
  assertPermission,
  assertProfessionalScope,
} from "../../guards";
import { RepositoryError, type TransactionInput } from "../../types";
import {
  auditWrite,
  docPath,
  requireTransaction,
  stamp,
  touch,
  type Plan,
  type PlanContext,
} from "../plan";

/**
 * Financeiro em centavos inteiros — `amountInCents` atravessa a camada sem
 * nenhuma conversao para ponto flutuante, aqui e no documento gravado.
 */

export function planCreateTransaction(
  ctx: PlanContext,
  input: TransactionInput,
): Plan<ID> {
  assertPermission(ctx.actor, "transaction:create");
  assertProfessionalScope(ctx.actor, input.professionalId);
  const id = ctx.newId("transactions");
  const client = input.clientId
    ? ctx.snapshot.clients.find((item) => item.id === input.clientId)
    : null;
  if (input.clientId && !client) throw new RepositoryError("Cadastro não encontrado.");
  if (client) {
    if (!input.professionalId) {
      throw new RepositoryError("Escolha o profissional responsável.");
    }
    assertClientProfessionalAssignment(
      client.assignedProfessionalIds,
      input.professionalId,
    );
  }

  const transaction: Transaction = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    ...input,
    clientName: client?.fullName ?? null,
    // Lancamento digitado a mao nao nasce de atendimento (E2.2).
    appointmentPart: null,
    paidAt: input.status === "PAID" ? ctx.now : null,
    gateway: null,
  };

  return {
    result: id,
    writes: [
      {
        op: "set",
        collection: "transactions",
        path: docPath(ctx, "transactions", id),
        data: transaction as unknown as Record<string, unknown>,
      },
      auditWrite(ctx, {
        action: "CREATE",
        actorType: "USER",
        resource: { type: "transaction", id },
        summary: `Lançamento "${input.description}" criado.`,
        metadata: { amountInCents: input.amountInCents, type: input.type },
      }),
    ],
  };
}

export function planUpdateTransaction(
  ctx: PlanContext,
  id: ID,
  input: Partial<TransactionInput>,
): Plan {
  assertPermission(ctx.actor, "transaction:update");
  const existing = requireTransaction(ctx, id);
  assertProfessionalScope(ctx.actor, existing.professionalId);
  if (input.professionalId !== undefined) {
    assertProfessionalScope(ctx.actor, input.professionalId);
  }
  const status = input.status ?? existing.status;
  const clientId = input.clientId === undefined ? existing.clientId : input.clientId;
  const professionalId =
    input.professionalId === undefined
      ? existing.professionalId
      : input.professionalId;
  const client = clientId
    ? ctx.snapshot.clients.find((item) => item.id === clientId)
    : null;
  if (clientId && !client) throw new RepositoryError("Cadastro não encontrado.");
  if (client) {
    if (!professionalId) {
      throw new RepositoryError("Escolha o profissional responsável.");
    }
    assertClientProfessionalAssignment(client.assignedProfessionalIds, professionalId);
  }

  return {
    result: undefined,
    writes: [
      {
        op: "update",
        collection: "transactions",
        path: docPath(ctx, "transactions", id),
        data: {
          ...input,
          clientName: input.clientId
            ? (client?.fullName ?? null)
            : existing.clientName,
          status,
          paidAt:
            status === "PAID"
              ? (existing.paidAt ?? ctx.now)
              : status === "PENDING"
                ? null
                : existing.paidAt,
          ...touch(ctx),
        },
      },
      auditWrite(ctx, {
        action: "UPDATE",
        actorType: "USER",
        resource: { type: "transaction", id },
        summary: `Lançamento "${input.description ?? existing.description}" atualizado.`,
        metadata: { status },
      }),
    ],
  };
}

export function planDeleteTransaction(ctx: PlanContext, id: ID): Plan {
  assertPermission(ctx.actor, "transaction:delete");
  const existing = requireTransaction(ctx, id);
  assertProfessionalScope(ctx.actor, existing.professionalId);

  return {
    result: undefined,
    writes: [
      { op: "delete", path: docPath(ctx, "transactions", id) },
      auditWrite(ctx, {
        action: "DELETE",
        actorType: "USER",
        resource: { type: "transaction", id },
        summary: `Lançamento "${existing.description}" excluído.`,
      }),
    ],
  };
}
