import { formatCurrency } from "@/lib/utils/format";
import {
  RECURRING_STATUS_AUDIT,
  currentMonthLaunch,
  statusTransitionError,
  validateRecurringCharge,
  type RecurringChargeInput,
} from "@/lib/finance/recurring";
import type { ID, RecurringCharge, RecurringChargeStatus } from "@/types";

import { assertPermission } from "../../guards";
import { RepositoryError, type RecurringChargeUpdate } from "../../types";
import {
  auditWrite,
  docPath,
  requireClient,
  stamp,
  touch,
  type Plan,
  type PlanContext,
  type WriteOperation,
} from "../plan";

/**
 * Mensalidades (cobrador dos clientes, C1). A regra mora em
 * `lib/finance/recurring.ts`, a mesma da demonstracao e da rotina diaria.
 */

function requireCharge(ctx: PlanContext, id: ID): RecurringCharge {
  const charge = ctx.snapshot.recurringCharges?.find((item) => item.id === id);
  if (!charge) throw new RepositoryError("Mensalidade não encontrada.");
  return charge;
}

/** O mes e o marcador saem juntos: sem o marcador, a rotina lancaria de novo. */
function launch(ctx: PlanContext, charge: RecurringCharge): { charge: RecurringCharge; writes: WriteOperation[] } {
  const launched = currentMonthLaunch(charge, { now: ctx.now, userId: ctx.actor.userId });
  if (!launched) return { charge, writes: [] };
  return {
    charge: { ...charge, lastLaunchedPeriod: launched.period ?? null },
    writes: [
      {
        op: "set",
        collection: "transactions",
        path: docPath(ctx, "transactions", launched.id),
        data: launched as unknown as Record<string, unknown>,
      },
    ],
  };
}

export function planCreateRecurringCharge(ctx: PlanContext, raw: RecurringChargeInput): Plan<ID> {
  assertPermission(ctx.actor, "transaction:create");
  const validation = validateRecurringCharge(raw);
  if (!validation.ok) throw new RepositoryError(validation.error);
  const input = validation.value;
  const client = requireClient(ctx, input.clientId);

  const id = ctx.newId("recurringCharges");
  const launched = launch(ctx, {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    ...input,
    clientName: client.fullName,
    lastLaunchedPeriod: null,
    status: "ACTIVE",
    endedAt: null,
  });
  const charge = launched.charge;

  return {
    result: id,
    writes: [
      {
        op: "set",
        collection: "recurringCharges",
        path: docPath(ctx, "recurringCharges", id),
        data: charge as unknown as Record<string, unknown>,
      },
      ...launched.writes,
      auditWrite(ctx, {
        action: "CREATE",
        actorType: "USER",
        resource: { type: "recurringCharge", id },
        summary: `Mensalidade "${charge.description}" criada: ${formatCurrency(charge.amountInCents)} todo dia ${charge.dueDay}.`,
        metadata: { amountInCents: charge.amountInCents, dueDay: charge.dueDay, startPeriod: charge.startPeriod },
      }),
    ],
  };
}

export function planUpdateRecurringCharge(ctx: PlanContext, id: ID, patch: RecurringChargeUpdate): Plan {
  assertPermission(ctx.actor, "transaction:update");
  const existing = requireCharge(ctx, id);
  if (existing.status === "ENDED") throw new RepositoryError("Mensalidade encerrada não muda.");
  const validation = validateRecurringCharge({ ...existing, ...patch, clientId: existing.clientId });
  if (!validation.ok) throw new RepositoryError(validation.error);
  const { description, amountInCents, method, dueDay } = validation.value;

  return {
    result: undefined,
    writes: [
      {
        op: "update",
        collection: "recurringCharges",
        path: docPath(ctx, "recurringCharges", id),
        data: { description, amountInCents, method, dueDay, ...touch(ctx) },
      },
      auditWrite(ctx, {
        action: "UPDATE",
        actorType: "USER",
        resource: { type: "recurringCharge", id },
        summary: `Mensalidade "${description}" alterada; vale a partir do próximo mês lançado.`,
        // O valor antigo entra na trilha: "quanto era antes" e a pergunta de sempre.
        metadata: {
          amountInCents,
          previousAmountInCents: existing.amountInCents,
          dueDay,
          previousDueDay: existing.dueDay,
        },
      }),
    ],
  };
}

export function planSetRecurringChargeStatus(ctx: PlanContext, id: ID, status: RecurringChargeStatus): Plan {
  assertPermission(ctx.actor, "transaction:update");
  const existing = requireCharge(ctx, id);
  const error = statusTransitionError(existing.status, status);
  if (error) throw new RepositoryError(error);
  const resumed = status === "ACTIVE"
    ? launch(ctx, { ...existing, status })
    : { charge: existing, writes: [] };

  return {
    result: undefined,
    writes: [
      {
        op: "update",
        collection: "recurringCharges",
        path: docPath(ctx, "recurringCharges", id),
        data: {
          status,
          endedAt: status === "ENDED" ? ctx.now : null,
          lastLaunchedPeriod: resumed.charge.lastLaunchedPeriod,
          ...touch(ctx),
        },
      },
      ...resumed.writes,
      auditWrite(ctx, {
        action: "UPDATE",
        actorType: "USER",
        resource: { type: "recurringCharge", id },
        summary: RECURRING_STATUS_AUDIT[status],
        metadata: { status, previousStatus: existing.status },
      }),
    ],
  };
}
