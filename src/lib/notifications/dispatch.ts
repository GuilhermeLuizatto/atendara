import type { ID, ISODateString, NotificationDelivery } from "@/types";

import {
  applyAttempt,
  isDue,
  isExpired,
  type DeliveryTransition,
} from "./delivery";
import { providerFor } from "./providers";
import { hashBody } from "./templates";

/**
 * Execucao de uma entrega planejada.
 *
 * O texto e o destino NAO vem do registro de entrega — o registro nao os guarda.
 * Vem recompostos do cadastro e do modelo, no momento do envio. Isso tem tres
 * efeitos: a trilha nao vira uma segunda copia dos contatos; um consentimento
 * revogado depois do planejamento impede o envio, porque a recomposicao falha; e
 * `bodyHash` deixa de ser enfeite, virando a conferencia de que o texto
 * reconstruido e o mesmo que foi aprovado no planejamento.
 */

export interface DispatchTarget {
  delivery: NotificationDelivery;
  /** Destino recomposto do cadastro. `null` = nao ha mais como enviar. */
  destination: string | null;
  /** Texto recomposto do modelo. `null` = o modelo deixou de ser valido. */
  body: string | null;
}

export type DispatchDecision =
  | { action: "SENT" | "RETRY" | "FAILED"; transition: DeliveryTransition }
  | { action: "CANCELLED"; reason: "EXPIRED" | "NO_LONGER_ELIGIBLE" | "BODY_CHANGED" }
  | { action: "SKIPPED"; reason: "NOT_DUE" };

export async function dispatchDelivery(
  target: DispatchTarget,
  now: ISODateString,
): Promise<DispatchDecision> {
  const { delivery, destination, body } = target;

  if (isExpired(delivery, now)) {
    return { action: "CANCELLED", reason: "EXPIRED" };
  }
  if (!isDue(delivery, now)) {
    return { action: "SKIPPED", reason: "NOT_DUE" };
  }
  if (!destination || !body) {
    return { action: "CANCELLED", reason: "NO_LONGER_ELIGIBLE" };
  }
  if (hashBody(body) !== delivery.bodyHash) {
    // O texto mudou entre planejar e enviar (modelo editado, cadastro alterado).
    // Enviar mesmo assim entregaria algo que ninguem revisou.
    return { action: "CANCELLED", reason: "BODY_CHANGED" };
  }

  const provider = providerFor(delivery.channel);
  const result = await provider.send({
    deliveryId: delivery.id,
    channel: delivery.channel,
    destination,
    body,
    attempt: delivery.attempts + 1,
  });

  const transition = applyAttempt(delivery, result, now);
  const action =
    transition.status === "SENT"
      ? "SENT"
      : transition.status === "PLANNED"
        ? "RETRY"
        : "FAILED";

  return { action, transition };
}

export interface DispatchSummary {
  sent: number;
  retrying: number;
  failed: number;
  cancelled: number;
  skipped: number;
  /** Ids afetados, na ordem em que foram tratados. Util para teste e auditoria. */
  touched: ID[];
}

export function emptySummary(): DispatchSummary {
  return { sent: 0, retrying: 0, failed: 0, cancelled: 0, skipped: 0, touched: [] };
}

export function tally(
  summary: DispatchSummary,
  id: ID,
  decision: DispatchDecision,
): DispatchSummary {
  const next = { ...summary, touched: [...summary.touched, id] };
  switch (decision.action) {
    case "SENT":
      next.sent += 1;
      break;
    case "RETRY":
      next.retrying += 1;
      break;
    case "FAILED":
      next.failed += 1;
      break;
    case "CANCELLED":
      next.cancelled += 1;
      break;
    case "SKIPPED":
      next.skipped += 1;
      next.touched.pop();
      break;
  }
  return next;
}
