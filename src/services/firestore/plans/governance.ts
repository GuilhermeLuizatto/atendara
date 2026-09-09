import type { ID } from "@/types";

import type { AuditInput, NotificationInput } from "../../types";
import {
  auditWrite,
  docPath,
  notificationWrite,
  touch,
  type Plan,
  type PlanContext,
  type WriteOperation,
} from "../plan";

/**
 * Notificacoes e trilha de auditoria.
 *
 * As Security Rules permitem que o usuario apenas marque uma notificacao como
 * lida ou reconhecida — nunca reescreva o alerta. Os campos abaixo sao os
 * mesmos que `onlyChanges([...])` autoriza em `firestore.rules`.
 */

export function planCreateNotification(
  ctx: PlanContext,
  input: NotificationInput,
): Plan<ID> {
  const { write, id } = notificationWrite(ctx, input);
  return { result: id, writes: [write] };
}

export function planAcknowledgeNotification(
  ctx: PlanContext,
  id: ID,
): Plan {
  return {
    result: undefined,
    writes: [
      {
        op: "update",
        collection: "notifications",
        path: docPath(ctx, "notifications", id),
        data: {
          status: "ACKNOWLEDGED",
          acknowledgedBy: ctx.actor.userId,
          acknowledgedAt: ctx.now,
          ...touch(ctx),
        },
      },
    ],
  };
}

export function planMarkAllNotificationsRead(ctx: PlanContext): Plan {
  const writes: WriteOperation[] = ctx.snapshot.notifications
    .filter((notification) => notification.status === "UNREAD")
    .map((notification) => ({
      op: "update" as const,
      collection: "notifications" as const,
      path: docPath(ctx, "notifications", notification.id),
      data: { status: "READ", ...touch(ctx) },
    }));

  return { result: undefined, writes };
}

export function planAppendAuditLog(
  ctx: PlanContext,
  input: AuditInput,
): Plan<ID> {
  const write = auditWrite(ctx, input);
  return { result: write.path.split("/").pop() as ID, writes: [write] };
}
