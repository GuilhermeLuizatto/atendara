import type { ID, Transaction } from "@/types";

import { assertPermission } from "../../guards";
import type { TransactionInput } from "../../types";
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
  const id = ctx.newId("transactions");
  const client = input.clientId
    ? ctx.snapshot.clients.find((item) => item.id === input.clientId)
    : null;

  const transaction: Transaction = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    ...input,
    clientName: client?.fullName ?? null,
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
  const status = input.status ?? existing.status;
  const client = input.clientId
    ? ctx.snapshot.clients.find((item) => item.id === input.clientId)
    : null;

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
