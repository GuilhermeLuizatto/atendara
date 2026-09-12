import type { ConvertedCollection } from "@/lib/firebase/converters";
import {
  messagePath,
  paths,
  type TenantCollection,
} from "@/lib/firebase/paths";
import type {
  Appointment,
  AuditLog,
  Client,
  Conversation,
  ID,
  ISODateString,
  Notification,
  Professional,
  Transaction,
} from "@/types";

import {
  RepositoryError,
  type AuditInput,
  type NotificationInput,
  type RepositoryActor,
  type WorkspaceSnapshot,
} from "../types";

/**
 * Plano de escrita: o que uma mutacao produz, antes de tocar o SDK.
 *
 * Cada operacao do repositorio e uma funcao PURA do snapshot atual para uma
 * lista de escritas. Duas consequencias praticas: a regra de negocio
 * (conflito de horario, cancelamento que cancela a receita, regra imutavel que
 * recusa edicao) fica testavel em milissegundos sem emulador; e o repositorio
 * vira um executor pequeno, que so traduz o plano em `writeBatch`.
 *
 * As escritas de um mesmo plano sao aplicadas juntas. Uma mensagem sem a
 * decisao que a originou, ou um cancelamento sem a baixa da receita, seriam
 * trilhas parciais — exatamente o que a auditoria nao pode ter.
 */

export type WriteOperation =
  | {
      op: "set";
      collection: ConvertedCollection;
      path: string;
      data: Record<string, unknown>;
    }
  | {
      op: "update";
      collection: ConvertedCollection;
      path: string;
      data: Record<string, unknown>;
    }
  | { op: "delete"; path: string };

export interface Plan<T = void> {
  writes: WriteOperation[];
  result: T;
}

export interface PlanContext {
  organizationId: ID;
  snapshot: WorkspaceSnapshot;
  actor: RepositoryActor;
  now: ISODateString;
  /** Id gerado localmente pelo SDK; nao exige ida ao servidor. */
  newId: (collection: TenantCollection) => ID;
  newMessageId: (conversationId: ID) => ID;
}

// ------------------------------------------------------------- caminhos

export function docPath(
  ctx: PlanContext,
  collection: TenantCollection,
  id: ID,
): string {
  return paths.document(ctx.organizationId, collection, id);
}

export function messageDocPath(
  ctx: PlanContext,
  conversationId: ID,
  messageId: ID,
): string {
  return messagePath(ctx.organizationId, conversationId, messageId);
}

// --------------------------------------------------------------- carimbos

export function stamp(ctx: PlanContext) {
  return {
    createdAt: ctx.now,
    updatedAt: ctx.now,
    createdBy: ctx.actor.userId,
    updatedBy: ctx.actor.userId,
  };
}

export function touch(ctx: PlanContext) {
  return { updatedAt: ctx.now, updatedBy: ctx.actor.userId };
}

// ---------------------------------------------------------------- buscas

export function requireClient(ctx: PlanContext, id: ID): Client {
  const client = ctx.snapshot.clients.find((item) => item.id === id);
  if (!client) throw new RepositoryError("Cadastro não encontrado.");
  return client;
}

export function requireProfessional(ctx: PlanContext, id: ID): Professional {
  const professional = ctx.snapshot.professionals.find(
    (item) => item.id === id,
  );
  if (!professional) throw new RepositoryError("Profissional não encontrado.");
  return professional;
}

export function requireAppointment(ctx: PlanContext, id: ID): Appointment {
  const appointment = ctx.snapshot.appointments.find((item) => item.id === id);
  if (!appointment) throw new RepositoryError("Atendimento não encontrado.");
  return appointment;
}

export function requireTransaction(ctx: PlanContext, id: ID): Transaction {
  const transaction = ctx.snapshot.transactions.find((item) => item.id === id);
  if (!transaction) throw new RepositoryError("Lançamento não encontrado.");
  return transaction;
}

export function requireConversation(ctx: PlanContext, id: ID): Conversation {
  const conversation = ctx.snapshot.conversations.find(
    (item) => item.id === id,
  );
  if (!conversation) throw new RepositoryError("Conversa não encontrada.");
  return conversation;
}

// ------------------------------------------------- auditoria e alertas

/**
 * `auditLogs` e `aiDecisions` sao append-only tambem no banco: as Security
 * Rules aceitam `create` e negam `update`/`delete` para qualquer papel.
 */
export function auditWrite(ctx: PlanContext, input: AuditInput): WriteOperation {
  const id = ctx.newId("auditLogs");
  const entry: AuditLog = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    actorType: input.actorType,
    actorId: ctx.actor.userId,
    actorName: input.actorName ?? ctx.actor.name,
    action: input.action,
    resource: input.resource,
    summary: input.summary,
    metadata: input.metadata ?? {},
    occurredAt: ctx.now,
  };

  return {
    op: "set",
    collection: "auditLogs",
    path: docPath(ctx, "auditLogs", id),
    data: entry as unknown as Record<string, unknown>,
  };
}

export function buildNotification(
  ctx: PlanContext,
  input: NotificationInput,
): Notification {
  return {
    id: ctx.newId("notifications"),
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    type: input.type,
    priority: input.priority,
    status: "UNREAD",
    title: input.title,
    body: input.body,
    professionalId: input.professionalId,
    target: input.target,
    channels: ["DASHBOARD"],
    aiDecisionId: input.aiDecisionId,
    acknowledgedBy: null,
    acknowledgedAt: null,
  };
}

export function notificationWrite(
  ctx: PlanContext,
  input: NotificationInput,
): { write: WriteOperation; id: ID } {
  const notification = buildNotification(ctx, input);
  return {
    id: notification.id,
    write: {
      op: "set",
      collection: "notifications",
      path: docPath(ctx, "notifications", notification.id),
      data: notification as unknown as Record<string, unknown>,
    },
  };
}
