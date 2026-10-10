import { canTeamMoveLead } from "@/lib/leads/lifecycle";
import type { Conversation, ID, Lead, LeadStatus } from "@/types";

import {
  actorCan,
  assertPermission,
  assertProfessionalScope,
} from "../../guards";
import { RepositoryError } from "../../types";
import {
  auditWrite,
  docPath,
  requireConversation,
  touch,
  type Plan,
  type PlanContext,
  type WriteOperation,
} from "../plan";

/**
 * Primeiro contato e tomada humana pelo painel.
 *
 * O lead nasce no backend; aqui a equipe só muda a situação. Assumir e
 * devolver a conversa à Dara são atos humanos com trilha: assumir para a
 * automação na hora, e devolver exige o registro no mesmo lote — as rules
 * recusam a devolução sem ele (`automationResumeOk`).
 */

const TAKEOVER_REASON = "Conversa assumida pelo profissional.";

function requireLead(ctx: PlanContext, id: ID): Lead {
  const lead = (ctx.snapshot.leads ?? []).find((item) => item.id === id);
  if (!lead) throw new RepositoryError("Contato não encontrado.");
  return lead;
}

function leadUpdate(
  ctx: PlanContext,
  lead: Lead,
  status: LeadStatus,
): WriteOperation[] {
  return [
    {
      op: "update",
      collection: "leads",
      path: docPath(ctx, "leads", lead.id),
      data: { status, statusChangedAt: ctx.now, ...touch(ctx) },
    },
    auditWrite(ctx, {
      action: "UPDATE",
      actorType: "USER",
      resource: { type: "lead", id: lead.id },
      summary:
        status === "TAKEN_OVER"
          ? "Contato sem cadastro assumido pela equipe."
          : "Contato sem cadastro encerrado pela equipe.",
      metadata: { from: lead.status, to: status },
    }),
  ];
}

/**
 * O que assumir a conversa grava, além do que a tela já pede: quando e por
 * onde, e o lead da conversa como assumido. Conversa já assumida não muda.
 */
export function takeoverWrites(
  ctx: PlanContext,
  conversation: Conversation,
): { patch: Partial<Conversation>; writes: WriteOperation[] } {
  if (conversation.humanTakeoverAt && conversation.escalated) {
    return { patch: {}, writes: [] };
  }
  const lead = conversation.leadId
    ? (ctx.snapshot.leads ?? []).find((item) => item.id === conversation.leadId)
    : undefined;
  const writes =
    lead &&
    actorCan(ctx.actor, "lead:manage") &&
    canTeamMoveLead(lead.status, "TAKEN_OVER")
      ? leadUpdate(ctx, lead, "TAKEN_OVER")
      : [];
  return {
    patch: { humanTakeoverAt: ctx.now, humanTakeoverSource: "PANEL" },
    writes,
  };
}

export function planUpdateLeadStatus(
  ctx: PlanContext,
  leadId: ID,
  status: Extract<LeadStatus, "TAKEN_OVER" | "CLOSED">,
): Plan {
  assertPermission(ctx.actor, "lead:manage");
  const lead = requireLead(ctx, leadId);
  assertProfessionalScope(ctx.actor, lead.professionalId);
  if (!canTeamMoveLead(lead.status, status)) {
    throw new RepositoryError("Esta mudança de situação não é permitida.");
  }

  const writes = leadUpdate(ctx, lead, status);
  // Assumir o lead é assumir a conversa: a Dara para na hora.
  const conversation = ctx.snapshot.conversations.find(
    (item) => item.id === lead.conversationId,
  );
  if (status === "TAKEN_OVER" && conversation && !conversation.escalated) {
    writes.push({
      op: "update",
      collection: "conversations",
      path: docPath(ctx, "conversations", conversation.id),
      data: {
        escalated: true,
        escalationReason: TAKEOVER_REASON,
        status: "WAITING_PROFESSIONAL",
        humanTakeoverAt: ctx.now,
        humanTakeoverSource: "PANEL",
        ...touch(ctx),
      },
    });
  }
  return { result: undefined, writes };
}

/**
 * Devolve a conversa à Dara. Transição explícita: só de conversa assumida, e
 * sempre com a entrada da trilha que as rules exigem no mesmo lote.
 */
export function planResumeConversationAutomation(
  ctx: PlanContext,
  conversationId: ID,
): Plan {
  assertPermission(ctx.actor, "conversation:reply");
  const conversation = requireConversation(ctx, conversationId);
  assertProfessionalScope(ctx.actor, conversation.professionalId);
  if (!conversation.escalated) {
    throw new RepositoryError("A conversa já está com a assistente.");
  }

  const audit = auditWrite(ctx, {
    action: "UPDATE",
    actorType: "USER",
    resource: { type: "conversation", id: conversationId },
    summary: "Automação retomada pelo profissional.",
  });
  const auditId = audit.path.split("/").pop() as ID;
  return {
    result: undefined,
    writes: [
      audit,
      {
        op: "update",
        collection: "conversations",
        path: docPath(ctx, "conversations", conversationId),
        data: {
          escalated: false,
          escalationReason: null,
          attention: "NORMAL",
          status: "OPEN",
          unreadCount: 0,
          automationResumeAuditId: auditId,
          ...touch(ctx),
        },
      },
    ],
  };
}
