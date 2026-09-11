import { AI_ASSISTANT_NAME, AI_ENGINE_VERSION } from "@/config/app";
import { classificationMeta } from "@/config/classifications";
import {
  ADMIN_EXCHANGES,
  AGENT_REPLIES,
  ESCALATION_REASONS,
  templatesFor,
} from "@/mocks/content";
import { addMinutesISO, atTime, shiftDays } from "@/mocks/dates";
import { formatCurrency } from "@/lib/utils/format";
import { decisionInputPreview } from "@/lib/privacy/decision-preview";
import type {
  AIDecision,
  AIRule,
  AttentionLevel,
  Client,
  Conversation,
  Message,
  MessageChannel,
  MessageClassificationId,
} from "@/types";

import { PROFESSIONAL_RULE_IDS } from "./governance";
import { stamp, type GeneratorContext } from "./context";

export interface InboxData {
  conversations: Conversation[];
  messages: Message[];
  decisions: AIDecision[];
}

const CHANNELS: MessageChannel[] = [
  "WHATSAPP",
  "WHATSAPP",
  "EMAIL",
  "WEB_CHAT",
];

function attentionFor(classification: MessageClassificationId): AttentionLevel {
  if (classification === "POSSIBLE_RISK") return "CRITICAL";
  if (classification === "URGENT") return "HIGH";
  return classificationMeta(classification).autoResponseEligible
    ? "NORMAL"
    : "ATTENTION";
}

/**
 * Monta a caixa de entrada.
 *
 * A classificacao escolhida determina TUDO o que vem depois — acao, alerta,
 * status da conversa — exatamente como no motor real. Nenhuma decisao aqui e
 * escrita a mao por conversa.
 */
export function buildInbox(
  ctx: GeneratorContext,
  clients: Client[],
  rules: AIRule[],
): InboxData {
  const { rng, profession, organizationId, now, today } = ctx;

  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const decisions: AIDecision[] = [];

  const nonAdministrative = profession.messageClassifications.filter(
    (id) =>
      id !== "ADMINISTRATIVE" && id !== "POSSIBLE_RISK" && id !== "UNKNOWN",
  );

  // Composicao fixa da demonstracao: um risco, um nao classificado, dois
  // tecnicos e o restante administrativo. Cobre os quatro caminhos do motor.
  const plan: MessageClassificationId[] = [
    "POSSIBLE_RISK",
    "UNKNOWN",
    nonAdministrative[0] ?? "PROFESSIONAL",
    nonAdministrative[1] ?? nonAdministrative[0] ?? "PROFESSIONAL",
    "ADMINISTRATIVE",
    "ADMINISTRATIVE",
    "ADMINISTRATIVE",
    "ADMINISTRATIVE",
    "ADMINISTRATIVE",
  ];

  const participants = rng.sample(
    clients.filter((client) => client.status !== "INACTIVE"),
    plan.length,
  );

  const interpolate = (text: string): string =>
    text
      .replaceAll(
        "{atendimento}",
        profession.terminology.appointment.singularLower,
      )
      .replaceAll("{cliente}", profession.terminology.client.singularLower)
      .replaceAll(
        "{profissional}",
        profession.terminology.professional.singularLower,
      )
      .replaceAll("{preco}", formatCurrency(profession.defaultPriceInCents))
      .replaceAll(
        "{duracao}",
        String(profession.defaultAppointmentDurationMinutes),
      );

  plan.forEach((classification, index) => {
    const client = participants[index];
    if (!client) return;

    const meta = classificationMeta(classification);
    const conversationId = `conv-${index + 1}`;
    const channel = rng.pick(CHANNELS);

    // As conversas mais recentes ficam no topo da caixa de entrada.
    const hoursAgo = index * 3 + rng.int(0, 2);
    const sentAt = addMinutesISO(now, -(hoursAgo * 60 + rng.int(0, 55)));

    const exchange =
      classification === "ADMINISTRATIVE" ? rng.pick(ADMIN_EXCHANGES) : null;

    const questionText = interpolate(
      exchange
        ? exchange.question
        : rng.pick(templatesFor(profession.id, classification)),
    );

    const inboundId = `msg-${conversationId}-1`;
    messages.push({
      id: inboundId,
      organizationId,
      ...stamp(sentAt),
      conversationId,
      clientId: client.id,
      direction: "INBOUND",
      authorType: "CLIENT",
      authorName: client.fullName,
      channel,
      body: questionText,
      sentAt,
      readAt: null,
      classification,
      classificationConfidence: 0,
      aiDecisionId: null,
    });

    const appliedRuleId = exchange
      ? PROFESSIONAL_RULE_IDS[exchange.category]
      : undefined;
    const appliedRule = rules.find((rule) => rule.id === appliedRuleId);
    const ruleAllows = appliedRule?.enabled ?? false;

    // Guardamos a troca autorizada em vez de um booleano: o tipo carrega a
    // informacao de que existe categoria e resposta, sem assercao de tipo.
    const answeredExchange =
      exchange && meta.autoResponseEligible && ruleAllows ? exchange : null;
    const answered = answeredExchange !== null;

    const confidence = answered
      ? 0.9 + rng.next() * 0.09
      : classification === "UNKNOWN"
        ? 0.3 + rng.next() * 0.2
        : 0.82 + rng.next() * 0.14;

    const decisionId = `decision-${index + 1}`;
    const decidedAt = addMinutesISO(sentAt, 1);

    decisions.push({
      id: decisionId,
      organizationId,
      ...stamp(decidedAt),
      conversationId,
      messageId: inboundId,
      clientId: client.id,
      professionalId: client.assignedProfessionalId,
      inputPreview: decisionInputPreview(questionText, profession.sensitiveDataProfile),
      classification,
      confidence: Number(confidence.toFixed(2)),
      appliedRules: buildAppliedRules(rules, appliedRule?.id ?? null, answered),
      action: answered ? "AUTO_RESPONSE" : "ESCALATE_TO_PROFESSIONAL",
      responseText: answeredExchange
        ? interpolate(AGENT_REPLIES[answeredExchange.category])
        : null,
      reason: answered
        ? `Pergunta exclusivamente administrativa coberta pela regra "${appliedRule?.name}".`
        : ESCALATION_REASONS[classification],
      attention: attentionFor(classification),
      escalated: !answered,
      engineVersion: AI_ENGINE_VERSION,
      decidedAt,
      latencyMs: rng.int(280, 940),
    });

    // Reflete a confianca da decisao de volta na mensagem classificada.
    const inbound = messages.at(-1);
    if (inbound) {
      inbound.classificationConfidence = Number(confidence.toFixed(2));
      inbound.aiDecisionId = decisionId;
    }

    if (answeredExchange) {
      const replyAt = addMinutesISO(decidedAt, 1);
      messages.push({
        id: `msg-${conversationId}-2`,
        organizationId,
        ...stamp(replyAt),
        conversationId,
        clientId: client.id,
        direction: "OUTBOUND",
        authorType: "AI_AGENT",
        authorName: AI_ASSISTANT_NAME,
        channel,
        body: interpolate(AGENT_REPLIES[answeredExchange.category]),
        sentAt: replyAt,
        readAt: replyAt,
        classification: null,
        classificationConfidence: null,
        aiDecisionId: decisionId,
      });
    }

    const lastMessage = messages.at(-1);

    conversations.push({
      id: conversationId,
      organizationId,
      ...stamp(sentAt),
      clientId: client.id,
      clientName: client.fullName,
      professionalId: client.assignedProfessionalId,
      channel,
      status: answered ? "WAITING_CLIENT" : "WAITING_PROFESSIONAL",
      attention: attentionFor(classification),
      lastClassification: classification,
      lastMessagePreview: lastMessage?.body ?? questionText,
      lastMessageAt: lastMessage?.sentAt ?? sentAt,
      unreadCount: answered ? 0 : 1,
      escalated: !answered,
      escalationReason: answered ? null : ESCALATION_REASONS[classification],
    });
  });

  // Uma conversa ja resolvida, para a caixa de entrada nao parecer so alertas.
  const resolvedClient = clients.find(
    (client) => !participants.includes(client),
  );
  if (resolvedClient) {
    const resolvedAt = atTime(shiftDays(today, -2), 15, 40);
    conversations.push({
      id: "conv-resolved",
      organizationId,
      ...stamp(resolvedAt),
      clientId: resolvedClient.id,
      clientName: resolvedClient.fullName,
      professionalId: resolvedClient.assignedProfessionalId,
      channel: "WHATSAPP",
      status: "RESOLVED",
      attention: "NORMAL",
      lastClassification: "ADMINISTRATIVE",
      lastMessagePreview: "Perfeito, obrigado! Ate quinta.",
      lastMessageAt: resolvedAt,
      unreadCount: 0,
      escalated: false,
      escalationReason: null,
    });
  }

  conversations.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  return { conversations, messages, decisions };
}

/**
 * Trilha de regras avaliadas. As fundamentais aparecem sempre — mesmo quando
 * nao bloqueiam nada — porque a auditoria precisa mostrar que foram checadas.
 */
function buildAppliedRules(
  rules: AIRule[],
  matchedRuleId: string | null,
  answered: boolean,
) {
  const systemRules = rules
    .filter((rule) => rule.level === "SECURITY" || rule.level === "SYSTEM")
    .slice(0, 3)
    .map((rule) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      ruleVersion: rule.version,
      level: rule.level,
      outcome: "NOT_MATCHED" as const,
    }));

  if (!matchedRuleId) return systemRules;

  const matched = rules.find((rule) => rule.id === matchedRuleId);
  if (!matched) return systemRules;

  return [
    ...systemRules,
    {
      ruleId: matched.id,
      ruleName: matched.name,
      ruleVersion: matched.version,
      level: matched.level,
      outcome: answered ? ("MATCHED" as const) : ("DISABLED" as const),
    },
  ];
}
