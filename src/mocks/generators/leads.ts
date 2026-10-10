import { AI_ENGINE_VERSION } from "@/config/app";
import { LEAD_WHATSAPP_CONSENT, ROUTING_REASON_LABELS } from "@/config/leads";
import { decisionInputPreview } from "@/lib/privacy/decision-preview";
import { atTime, shiftDays } from "@/lib/utils/datetime";
import type {
  AIDecision,
  AIRule,
  Conversation,
  Lead,
  LeadStatus,
  Message,
  NotificationConsent,
  Professional,
  RoutingQueue,
  RoutingReason,
} from "@/types";

import { stamp, type GeneratorContext } from "./context";

/**
 * Contatos sem cadastro, para a fila de primeiro contato da demonstração.
 * Telefones fictícios da faixa 9000-000x e nenhum nome: o lead não informa um.
 */

interface LeadSeed {
  status: LeadStatus;
  queue: RoutingQueue;
  reason: RoutingReason;
  consent: "ABSENT" | "GRANTED" | "WITHDRAWN";
  text: string;
  daysAgo: number;
}

const SEEDS: LeadSeed[] = [
  {
    status: "WAITING_TEAM",
    queue: "AGENDA",
    reason: "AGENDA_REQUEST",
    consent: "ABSENT",
    text: "Olá, vocês têm horário na próxima semana?",
    daysAgo: 0,
  },
  {
    status: "NEW",
    queue: "COMMERCIAL",
    reason: "COMMERCIAL_QUESTION",
    consent: "GRANTED",
    text: "Qual o valor do primeiro atendimento?",
    daysAgo: 1,
  },
  {
    status: "TAKEN_OVER",
    queue: "HUMAN_REVIEW",
    reason: "AMBIGUOUS",
    consent: "WITHDRAWN",
    text: "Queria saber o preço e se dá para mudar o dia.",
    daysAgo: 2,
  },
];

function consentFor(
  seed: LeadSeed,
  at: string,
): NotificationConsent | null {
  if (seed.consent === "ABSENT") return null;
  const act = {
    at,
    recordedBy: { kind: "SUBJECT" as const, userId: null },
    medium: "MESSAGE" as const,
  };
  return {
    formatVersion: 2,
    channels: {
      WHATSAPP: [
        {
          granted: act,
          textVersion: LEAD_WHATSAPP_CONSENT.textVersion,
          subjectIsMinor: false,
          legalGuardian: null,
          withdrawn: seed.consent === "WITHDRAWN" ? act : null,
        },
      ],
    },
    legacy: null,
  };
}

export function buildLeads(
  ctx: GeneratorContext,
  professionals: Professional[],
  rules: AIRule[],
): {
  leads: Lead[];
  conversations: Conversation[];
  messages: Message[];
  decisions: AIDecision[];
} {
  const leads: Lead[] = [];
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const decisions: AIDecision[] = [];
  const professionalId = professionals[0]?.id ?? null;
  // As fundamentais aparecem na trilha mesmo sem bloquear nada.
  const appliedRules = rules
    .filter((rule) => rule.level === "SECURITY" || rule.level === "SYSTEM")
    .slice(0, 3)
    .map((rule) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      ruleVersion: rule.version,
      level: rule.level,
      outcome: "NOT_MATCHED" as const,
    }));

  SEEDS.forEach((seed, index) => {
    const at = atTime(shiftDays(ctx.today, -seed.daysAgo), 9 + index, 15);
    const id = `lead-demo-${index + 1}`;
    const conversationId = `wa-contato-demo-${index + 1}`;
    const phone = `+551190000000${index + 1}`;
    const taken = seed.status === "TAKEN_OVER";

    leads.push({
      id,
      organizationId: ctx.organizationId,
      ...stamp(at),
      source: "WHATSAPP",
      conversationId,
      phone,
      contactHint: `***${phone.slice(-4)}`,
      professionalId,
      status: seed.status,
      queue: seed.queue,
      routingReason: seed.reason,
      attention: seed.status === "NEW" ? "NORMAL" : "HIGH",
      firstContactAt: at,
      lastContactAt: at,
      statusChangedAt: at,
      notificationConsent: consentFor(seed, at),
    });
    conversations.push({
      id: conversationId,
      organizationId: ctx.organizationId,
      ...stamp(at),
      clientId: null,
      clientName: "Contato não identificado",
      professionalId,
      channel: "WHATSAPP",
      status: taken ? "WAITING_CLIENT" : "WAITING_PROFESSIONAL",
      attention: seed.status === "NEW" ? "NORMAL" : "HIGH",
      lastClassification: "ADMINISTRATIVE",
      lastMessagePreview: seed.text,
      lastMessageAt: at,
      unreadCount: taken ? 0 : 1,
      escalated: seed.status !== "NEW",
      escalationReason: taken
        ? "Conversa assumida pelo profissional."
        : seed.status === "NEW"
          ? null
          : "Contato sem cadastro aguarda a equipe.",
      leadId: id,
      humanTakeoverAt: taken ? at : null,
      humanTakeoverSource: taken ? "PANEL" : null,
    });
    const messageId = `${conversationId}-m1`;
    decisions.push({
      id: `${messageId}-decision`,
      organizationId: ctx.organizationId,
      ...stamp(at),
      conversationId,
      messageId,
      clientId: null,
      professionalId,
      inputPreview: decisionInputPreview(seed.text, ctx.profession.sensitiveDataProfile),
      classification: "ADMINISTRATIVE",
      confidence: 0.9,
      appliedRules,
      // Demonstração: nenhum contato novo recebe resposta automática.
      action: "ESCALATE_TO_PROFESSIONAL",
      responseText: null,
      reason: `Contato sem cadastro encaminhado à equipe: ${ROUTING_REASON_LABELS[seed.reason].toLowerCase()}.`,
      attention: seed.status === "NEW" ? "NORMAL" : "HIGH",
      escalated: true,
      engineVersion: AI_ENGINE_VERSION,
      decidedAt: at,
      latencyMs: 400,
    });
    messages.push({
      id: messageId,
      organizationId: ctx.organizationId,
      ...stamp(at),
      conversationId,
      clientId: null,
      professionalId,
      direction: "INBOUND",
      authorType: "CLIENT",
      authorName: "Contato não identificado",
      channel: "WHATSAPP",
      body: seed.text,
      sentAt: at,
      readAt: null,
      classification: "ADMINISTRATIVE",
      classificationConfidence: 0.9,
      aiDecisionId: `${messageId}-decision`,
    });
  });

  return { leads, conversations, messages, decisions };
}
