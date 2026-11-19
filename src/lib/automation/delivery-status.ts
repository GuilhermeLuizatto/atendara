import { metaErrorFailureCode } from "@/lib/notifications/providers/meta-cloud-api";
import type {
  DeliveryFailureCode,
  ISODateString,
  NotificationDelivery,
} from "@/types";

/**
 * A outra metade da rota da Cloud API: o que a Meta conta depois do envio.
 *
 * O provedor devolve "aceito", que quer dizer "a Meta recebeu para entregar".
 * Entregue e lido chegam depois, pelo mesmo webhook assinado que traz as
 * mensagens — num campo diferente (`statuses`). Sem isto, `deliveredAt` e
 * `readAt` ficariam vazios para sempre, e o painel contaria zero entregas
 * sobre avisos que chegaram.
 *
 * O que este modulo NAO faz: nao fala com a Meta, nao le banco e nao decide
 * tentativa. Ele traduz o corpo em fatos e diz quais campos mudam.
 */

export type DeliveryStatusKind = "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface DeliveryStatusEvent {
  /** Numero que enviou, para achar a organizacao dona da entrega. */
  providerSenderId: string;
  /** Protocolo da Meta, gravado quando o envio foi aceito. */
  providerMessageId: string;
  kind: DeliveryStatusKind;
  occurredAt: ISODateString;
  /** Só em `FAILED`: por que a Meta desistiu. */
  failureCode: DeliveryFailureCode | null;
}

const KINDS: Record<string, DeliveryStatusKind> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

function errorCodeOf(status: Record<string, unknown>): number | null {
  const errors = status.errors;
  if (!Array.isArray(errors)) return null;
  const code = (errors[0] as { code?: unknown })?.code;
  return typeof code === "number" ? code : null;
}

/**
 * Corpo do webhook -> progressos, ignorando o que nao reconhece.
 *
 * Mesma severidade do parser de mensagens: id fora do formato, horario que
 * nao e numero ou estado desconhecido sao descartados em silencio. Um aviso
 * de status perdido nao machuca ninguem; um aviso inventado, sim.
 */
/** Horario da Meta (segundos, em texto) -> instante, ou `null` se nao for um. */
function instantOf(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  const instant = new Date(seconds * 1000);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

/** Um item de `statuses` -> progresso, ou `null` quando nao da para confiar. */
function eventOf(
  raw: unknown,
  providerSenderId: string,
): DeliveryStatusEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const status = raw as Record<string, unknown>;
  const id = typeof status.id === "string" ? status.id : null;
  const kind =
    typeof status.status === "string" ? KINDS[status.status] : undefined;
  const instant = instantOf(status.timestamp);
  if (!id || !/^[\x21-\x7e]{1,256}$/.test(id) || !kind || !instant) return null;

  return {
    providerSenderId,
    providerMessageId: id,
    kind,
    occurredAt: instant.toISOString(),
    failureCode:
      kind === "FAILED" ? metaErrorFailureCode(errorCodeOf(status)) : null,
  };
}

/** Os progressos de uma mudanca, ja com o numero que enviou. */
function eventsOf(change: unknown): DeliveryStatusEvent[] {
  const value = (change as { value?: unknown })?.value as
    | { metadata?: { phone_number_id?: unknown }; statuses?: unknown }
    | undefined;
  const providerSenderId = value?.metadata?.phone_number_id;
  if (typeof providerSenderId !== "string" || !Array.isArray(value?.statuses))
    return [];

  const events: DeliveryStatusEvent[] = [];
  for (const raw of value.statuses) {
    const event = eventOf(raw, providerSenderId);
    if (event) events.push(event);
  }
  return events;
}

export function parseDeliveryStatuses(data: unknown): DeliveryStatusEvent[] {
  if (typeof data !== "object" || data === null) return [];
  const entries = (data as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const events: DeliveryStatusEvent[] = [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) events.push(...eventsOf(change));
  }
  return events;
}

/**
 * O que o progresso carimba na entrega. `{}` quer dizer "nada a fazer".
 *
 * **Idempotente de proposito:** a Meta reentrega o mesmo aviso, e o primeiro
 * instante registrado e o que vale — carimbar de novo moveria para frente um
 * horario que ja aconteceu. Lida implica entregue, porque as vezes so o
 * segundo aviso chega.
 *
 * `SENT` nao muda nada: quem aceitou o envio ja gravou `sentAt`, e o aviso da
 * Meta chega depois, com horario igual ou posterior.
 */
export function deliveryStatusFields(
  delivery: Pick<
    NotificationDelivery,
    "status" | "deliveredAt" | "readAt" | "failureCode"
  >,
  event: DeliveryStatusEvent,
): Partial<NotificationDelivery> {
  if (event.kind === "SENT") return {};

  if (event.kind === "FAILED") {
    // Entrega ja cancelada ou ja falhada nao muda de motivo: o primeiro
    // registro e o que explica o que aconteceu.
    if (delivery.status === "FAILED" || delivery.status === "CANCELLED") return {};
    return { status: "FAILED", failureCode: event.failureCode };
  }

  if (event.kind === "DELIVERED") {
    return delivery.deliveredAt ? {} : { deliveredAt: event.occurredAt };
  }

  return {
    ...(delivery.deliveredAt ? {} : { deliveredAt: event.occurredAt }),
    ...(delivery.readAt ? {} : { readAt: event.occurredAt }),
  };
}
