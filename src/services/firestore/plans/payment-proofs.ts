import { reviewProofError } from "@/lib/finance/payment-proof";
import type { ID, PaymentProof } from "@/types";

import { assertPermission } from "../../guards";
import { RepositoryError } from "../../types";
import { auditWrite, docPath, requireTransaction, touch, type Plan, type PlanContext, type WriteOperation } from "../plan";

/**
 * Conferencia do comprovante (cobrador, C2). Aprovar e o "marcar como pago"
 * com prova: o mes vira pago no mesmo lote. Recusar deixa o mes como estava e
 * o link aceita outro envio.
 */

function requireProof(ctx: PlanContext, id: ID): PaymentProof {
  const proof = ctx.snapshot.paymentProofs?.find((item) => item.id === id);
  if (!proof) throw new RepositoryError("Comprovante não encontrado.");
  return proof;
}

export function planApprovePaymentProof(ctx: PlanContext, id: ID): Plan {
  assertPermission(ctx.actor, "transaction:update");
  const proof = requireProof(ctx, id);
  const error = reviewProofError(proof, { verdict: "APPROVED" });
  if (error) throw new RepositoryError(error);
  const transaction = requireTransaction(ctx, proof.transactionId);
  const opens = transaction.status === "PENDING" || transaction.status === "OVERDUE";

  const writes: WriteOperation[] = [
    {
      op: "update",
      collection: "paymentProofs",
      path: docPath(ctx, "paymentProofs", id),
      data: { status: "APPROVED", reviewedAt: ctx.now, reviewedBy: ctx.actor.userId, rejectionReason: null, ...touch(ctx) },
    },
  ];
  // Ja pago a mao antes da conferencia: o comprovante e aprovado, e a data de
  // pagamento que ja estava fica.
  if (opens) {
    writes.push({
      op: "update",
      collection: "transactions",
      path: docPath(ctx, "transactions", transaction.id),
      data: { status: "PAID", paidAt: ctx.now, ...touch(ctx) },
    });
  }
  writes.push(
    auditWrite(ctx, {
      action: "UPDATE",
      actorType: "USER",
      resource: { type: "paymentProof", id },
      summary: opens ? "Comprovante aprovado; mês marcado como pago." : "Comprovante aprovado.",
      metadata: { transactionId: transaction.id, verdict: "APPROVED" },
    }),
  );
  return { result: undefined, writes };
}

export function planRejectPaymentProof(ctx: PlanContext, id: ID, reason: string): Plan {
  assertPermission(ctx.actor, "transaction:update");
  const proof = requireProof(ctx, id);
  const error = reviewProofError(proof, { verdict: "REJECTED", reason });
  if (error) throw new RepositoryError(error);

  return {
    result: undefined,
    writes: [
      {
        op: "update",
        collection: "paymentProofs",
        path: docPath(ctx, "paymentProofs", id),
        data: { status: "REJECTED", reviewedAt: ctx.now, reviewedBy: ctx.actor.userId, rejectionReason: reason.trim(), ...touch(ctx) },
      },
      auditWrite(ctx, {
        action: "UPDATE",
        actorType: "USER",
        resource: { type: "paymentProof", id },
        summary: "Comprovante recusado; o link aceita outro envio.",
        // O motivo nao entra na trilha: e texto livre e pode citar a pessoa.
        metadata: { transactionId: proof.transactionId, verdict: "REJECTED" },
      }),
    ],
  };
}
