import { permissionsForRole } from "@/config/permissions";
import { getProfession } from "@/config/professions";
import { decide } from "@/lib/ai/decision-engine";
import type { AIDecision, Conversation, ID, Message } from "@/types";

import { assertPermission, validateMessageBody } from "../../guards";
import {
  RepositoryError,
  type DecisionInput,
  type MessageInput,
} from "../../types";
import {
  auditWrite,
  docPath,
  messageDocPath,
  notificationWrite,
  requireClient,
  requireConversation,
  stamp,
  touch,
  type Plan,
  type PlanContext,
  type WriteOperation,
} from "../plan";

/**
 * Conversas e mensagens.
 *
 * `messages` e subcolecao de `conversations` — e a colecao que mais cresce e
 * quase sempre e lida por conversa. As Security Rules aceitam apenas `create`:
 * preservar o que foi dito e o que permite auditar as decisoes do agente depois.
 */

function conversationUpdate(
  ctx: PlanContext,
  id: ID,
  data: Record<string, unknown>,
): WriteOperation {
  return {
    op: "update",
    collection: "conversations",
    path: docPath(ctx, "conversations", id),
    data: { ...data, ...touch(ctx) },
  };
}

function messageWrite(ctx: PlanContext, message: Message): WriteOperation {
  return {
    op: "set",
    collection: "messages",
    path: messageDocPath(ctx, message.conversationId, message.id),
    data: message as unknown as Record<string, unknown>,
  };
}

export function planAppendMessage(
  ctx: PlanContext,
  input: MessageInput,
): Plan<ID> {
  const conversation = requireConversation(ctx, input.conversationId);
  if (conversation.clientId !== input.clientId) {
    throw new RepositoryError("Cliente nao pertence a conversa.");
  }
  const body = validateMessageBody(input.body);
  const id = ctx.newMessageId(input.conversationId);

  const message: Message = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    ...input,
    body,
    sentAt: ctx.now,
    readAt: input.direction === "OUTBOUND" ? ctx.now : null,
  };

  return {
    result: id,
    writes: [
      messageWrite(ctx, message),
      conversationUpdate(ctx, input.conversationId, {
        lastMessagePreview: body,
        lastMessageAt: ctx.now,
        unreadCount:
          input.direction === "OUTBOUND" ? 0 : conversation.unreadCount + 1,
      }),
    ],
  };
}

export function planReplyToConversation(
  ctx: PlanContext,
  conversationId: ID,
  text: string,
): Plan {
  assertPermission(ctx.actor, "conversation:reply");
  const conversation = requireConversation(ctx, conversationId);
  const body = validateMessageBody(text);
  const id = ctx.newMessageId(conversationId);

  const message: Message = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    conversationId,
    clientId: conversation.clientId,
    direction: "OUTBOUND",
    authorType: "PROFESSIONAL",
    authorName: ctx.actor.name,
    channel: conversation.channel,
    body,
    sentAt: ctx.now,
    readAt: ctx.now,
    classification: null,
    classificationConfidence: null,
    aiDecisionId: null,
  };

  return {
    result: undefined,
    writes: [
      messageWrite(ctx, message),
      conversationUpdate(ctx, conversationId, {
        lastMessagePreview: body,
        lastMessageAt: ctx.now,
        status: "WAITING_CLIENT",
        unreadCount: 0,
        // Responder manualmente assume a conversa: o agente so volta a atuar
        // depois de liberacao explicita do profissional.
        escalated: true,
        escalationReason: "Conversa assumida pelo profissional.",
      }),
    ],
  };
}

export function planUpdateConversation(
  ctx: PlanContext,
  id: ID,
  patch: Partial<
    Pick<
      Conversation,
      "status" | "attention" | "escalated" | "escalationReason" | "unreadCount"
    >
  >,
): Plan {
  assertPermission(ctx.actor, "conversation:reply");
  requireConversation(ctx, id);
  return {
    result: undefined,
    writes: [conversationUpdate(ctx, id, { ...patch })],
  };
}

export function planRecordDecision(
  ctx: PlanContext,
  input: DecisionInput,
): Plan<ID> {
  const id = ctx.newId("aiDecisions");
  const decision: AIDecision = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    ...input,
    decidedAt: ctx.now,
  };

  return {
    result: id,
    writes: [
      {
        op: "set",
        collection: "aiDecisions",
        path: docPath(ctx, "aiDecisions", id),
        data: decision as unknown as Record<string, unknown>,
      },
      auditWrite(ctx, {
        action:
          input.action === "AUTO_RESPONSE" ? "AI_AUTO_RESPONSE" : "AI_ESCALATION",
        actorType: "AI_AGENT",
        actorName: ctx.snapshot.organization.settings.ai.displayName,
        resource: { type: "conversation", id: input.conversationId },
        summary: input.reason,
        metadata: {
          classification: input.classification,
          confidence: input.confidence,
        },
      }),
    ],
  };
}

/**
 * Simulador do agente: classifica a mensagem recebida, decide e publica tudo o
 * que a decisao produziu. Mensagem, decisao, resposta e alerta vao no mesmo
 * plano — e portanto no mesmo lote atomico — para evitar trilha parcial.
 */
export function planReceiveMessage(
  ctx: PlanContext,
  conversationId: ID,
  text: string,
  evaluatedAt?: string,
): Plan<ID> {
  assertPermission(ctx.actor, "conversation:reply");
  const conversation = requireConversation(ctx, conversationId);
  const client = requireClient(ctx, conversation.clientId);
  const body = validateMessageBody(text);
  const started = performance.now();

  const evaluationDate = new Date(evaluatedAt ?? ctx.now);
  if (!Number.isFinite(evaluationDate.getTime())) {
    throw new RepositoryError("Data de simulacao invalida.");
  }

  const outcome = decide({
    text: body,
    profession: getProfession(ctx.snapshot.organization.primaryProfession),
    organization: ctx.snapshot.organization,
    rules: ctx.snapshot.rules,
    professionalId: conversation.professionalId,
    permissions:
      ctx.actor.permissions ?? permissionsForRole(ctx.actor.role ?? "VIEWER"),
    humanHandoff: conversation.escalated,
    channel: conversation.channel,
    client: {
      modality: client.preferredModality,
      status: client.status,
      hasOutstandingBalance: client.outstandingBalanceInCents > 0,
    },
    now: evaluationDate,
  });

  const { trace, ...decision } = outcome;
  const messageId = ctx.newMessageId(conversationId);
  const decisionId = ctx.newId("aiDecisions");

  const incoming: Message = {
    id: messageId,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    conversationId,
    clientId: client.id,
    direction: "INBOUND",
    authorType: "CLIENT",
    authorName: client.fullName,
    channel: conversation.channel,
    body,
    sentAt: ctx.now,
    readAt: null,
    classification: decision.classification,
    classificationConfidence: decision.confidence,
    aiDecisionId: decisionId,
  };

  const writes: WriteOperation[] = [messageWrite(ctx, incoming)];
  let lastBody = body;

  if (decision.action === "AUTO_RESPONSE" && decision.responseText) {
    const reply: Message = {
      ...incoming,
      id: ctx.newMessageId(conversationId),
      direction: "OUTBOUND",
      authorType: "AI_AGENT",
      authorName: ctx.snapshot.organization.settings.ai.displayName,
      body: decision.responseText,
      readAt: ctx.now,
    };
    writes.push(messageWrite(ctx, reply));
    lastBody = reply.body;
  }

  const recorded: AIDecision = {
    ...decision,
    id: decisionId,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    conversationId,
    messageId,
    clientId: client.id,
    professionalId: conversation.professionalId,
    inputPreview: body.slice(0, 500),
    decidedAt: ctx.now,
    evaluatedAt: evaluationDate.toISOString(),
    latencyMs: Math.round(performance.now() - started),
  };

  writes.push({
    op: "set",
    collection: "aiDecisions",
    path: docPath(ctx, "aiDecisions", decisionId),
    data: recorded as unknown as Record<string, unknown>,
  });

  if (decision.escalated || decision.action === "SUGGEST_RESPONSE") {
    writes.push(
      notificationWrite(ctx, {
        type:
          decision.classification === "POSSIBLE_RISK"
            ? "POSSIBLE_RISK_DETECTED"
            : "CLIENT_WAITING",
        priority: decision.attention,
        title: `${client.fullName} aguarda atencao`,
        body: decision.reason,
        professionalId: conversation.professionalId,
        target: { type: "conversation", id: conversationId },
        aiDecisionId: decisionId,
      }).write,
    );
  }

  writes.push(
    conversationUpdate(ctx, conversationId, {
      status:
        decision.action === "AUTO_RESPONSE"
          ? "WAITING_CLIENT"
          : "WAITING_PROFESSIONAL",
      lastClassification: decision.classification,
      lastMessagePreview: lastBody,
      lastMessageAt: ctx.now,
      unreadCount: conversation.unreadCount + 1,
      // Uma conversa ja critica e assumida por um humano nao volta sozinha
      // para o nivel de atencao que a mensagem nova sugeriria.
      attention:
        conversation.attention === "CRITICAL" && conversation.escalated
          ? "CRITICAL"
          : decision.attention,
      escalated: decision.escalated,
      escalationReason: decision.escalated ? decision.reason : null,
    }),
    auditWrite(ctx, {
      action:
        decision.action === "AUTO_RESPONSE"
          ? "AI_AUTO_RESPONSE"
          : "AI_ESCALATION",
      actorType: "AI_AGENT",
      actorName: ctx.snapshot.organization.settings.ai.displayName,
      resource: { type: "conversation", id: conversationId },
      summary: decision.reason,
      metadata: {
        decisionId,
        classification: decision.classification,
        steps: trace.steps.length,
      },
    }),
  );

  return { result: decisionId, writes };
}
