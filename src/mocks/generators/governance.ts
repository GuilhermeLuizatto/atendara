import { AI_ASSISTANT_NAME } from "@/config/app";
import {
  materializeProfessionRules,
  materializeSystemRules,
} from "@/config/system-rules";
import { atTime, shiftDays } from "@/mocks/dates";
import type {
  AIDecision,
  AIRule,
  Appointment,
  AuditLog,
  Client,
  Notification,
  RuleCategory,
  Transaction,
} from "@/types";

import { stamp, type GeneratorContext } from "./context";

/**
 * Regras de nivel PROFESSIONAL, com id estavel por categoria. As decisoes da IA
 * referenciam esses ids, entao a tela de auditoria mostra exatamente qual regra
 * autorizou cada resposta.
 */
export const PROFESSIONAL_RULE_IDS: Partial<Record<RuleCategory, string>> = {
  PRICING: "rule-pricing",
  SCHEDULING: "rule-scheduling",
  CONFIRMATION: "rule-confirmation",
  RESCHEDULING: "rule-rescheduling",
  LOCATION: "rule-location",
  PAYMENT: "rule-payment",
};

interface ProfessionalRuleSeed {
  id: string;
  name: string;
  description: string;
  category: RuleCategory;
  enabled: boolean;
  priority: number;
}

const PROFESSIONAL_RULE_SEEDS: ProfessionalRuleSeed[] = [
  {
    id: "rule-pricing",
    name: "Informar preços",
    description:
      "O agente pode informar o valor e a duração do atendimento quando perguntado.",
    category: "PRICING",
    enabled: true,
    priority: 100,
  },
  {
    id: "rule-scheduling",
    name: "Informar horários",
    description: "O agente pode consultar a agenda e oferecer horários livres.",
    category: "SCHEDULING",
    enabled: true,
    priority: 90,
  },
  {
    id: "rule-confirmation",
    name: "Confirmar atendimento",
    description:
      "O agente pode confirmar um atendimento já agendado a pedido do cliente.",
    category: "CONFIRMATION",
    enabled: true,
    priority: 80,
  },
  {
    id: "rule-rescheduling",
    name: "Reagendar",
    description:
      "O agente pode oferecer horários alternativos e reservar a remarcação.",
    category: "RESCHEDULING",
    enabled: true,
    priority: 70,
  },
  {
    id: "rule-location",
    name: "Informar localização",
    description:
      "O agente pode informar endereço, referência e estacionamento próximo.",
    category: "LOCATION",
    enabled: true,
    priority: 60,
  },
  {
    id: "rule-payment",
    name: "Informar formas de pagamento",
    description:
      "O agente pode listar as formas de pagamento aceitas. Desativada para demonstrar o controle.",
    category: "PAYMENT",
    enabled: false,
    priority: 50,
  },
];

export function buildRules(ctx: GeneratorContext): AIRule[] {
  const { profession, organizationId, now } = ctx;

  const systemRules = materializeSystemRules(organizationId, now);

  const professionRules = materializeProfessionRules(
    organizationId,
    profession,
    now,
  );

  const professionalRules: AIRule[] = PROFESSIONAL_RULE_SEEDS.map((seed) => ({
    id: seed.id,
    organizationId,
    ...stamp(now),
    professionalId: "prof-owner",
    name: seed.name,
    description: seed.description,
    level: "PROFESSIONAL",
    category: seed.category,
    enabled: seed.enabled,
    priority: seed.priority,
    conditions: {
      combinator: "AND",
      conditions: [
        {
          field: "message.classification",
          operator: "EQUALS",
          value: "ADMINISTRATIVE",
        },
      ],
    },
    actions: [{ type: "ALLOW_TOPIC", payload: { topic: seed.category } }],
    source: "MANUAL",
    immutable: false,
    version: 1,
    naturalLanguageInput: null,
    lastAppliedAt: null,
  }));

  // Exemplo de regra contextual (Nivel 3) e de regra nascida de texto livre.
  const contextualRule: AIRule = {
    id: "rule-price-by-modality",
    organizationId,
    ...stamp(now),
    professionalId: "prof-owner",
    name: "Preço conforme a modalidade",
    description:
      "Quando o cliente pergunta preço: se a modalidade dele for online, informar o valor online; caso contrário, o presencial.",
    level: "CONTEXTUAL",
    category: "PRICING",
    enabled: true,
    priority: 40,
    conditions: {
      combinator: "AND",
      conditions: [
        {
          field: "message.classification",
          operator: "EQUALS",
          value: "ADMINISTRATIVE",
        },
        { field: "client.modality", operator: "EQUALS", value: "ONLINE" },
      ],
    },
    actions: [
      {
        type: "PROVIDE_INFO",
        payload: { info: "preco-online" },
      },
    ],
    source: "NATURAL_LANGUAGE",
    immutable: false,
    version: 2,
    naturalLanguageInput:
      "O agente pode informar que a consulta online custa R$ 180 e dura 50 minutos.",
    lastAppliedAt: now,
  };

  const preferenceRule: AIRule = {
    id: "rule-no-sunday",
    organizationId,
    ...stamp(now),
    professionalId: "prof-owner",
    name: "Não oferecer horários aos domingos",
    description:
      "O agente nunca sugere domingo ao propor horários, mesmo que a agenda esteja livre.",
    level: "PREFERENCE",
    category: "AVAILABILITY",
    enabled: true,
    priority: 30,
    conditions: {
      combinator: "AND",
      conditions: [
        { field: "context.dayOfWeek", operator: "EQUALS", value: 0 },
      ],
    },
    actions: [{ type: "DENY_TOPIC", payload: { topic: "domingo" } }],
    source: "NATURAL_LANGUAGE",
    immutable: false,
    version: 1,
    naturalLanguageInput: "Não quero atender aos domingos.",
    lastAppliedAt: null,
  };

  return [
    ...systemRules,
    ...professionRules,
    ...professionalRules,
    contextualRule,
    preferenceRule,
  ];
}

export function buildNotifications(
  ctx: GeneratorContext,
  decisions: AIDecision[],
  appointments: Appointment[],
  transactions: Transaction[],
  clients: Client[],
): Notification[] {
  const { organizationId, now, today } = ctx;
  const notifications: Notification[] = [];
  let sequence = 0;

  const push = (notification: Omit<Notification, "id">) => {
    sequence += 1;
    notifications.push({ ...notification, id: `notif-${sequence}` });
  };

  // Toda decisao escalada vira notificacao: e o canal pelo qual a IA trabalha
  // PARA o profissional, e nao apenas no lugar dele.
  const nameOf = (clientId: string) =>
    clients.find((client) => client.id === clientId)?.fullName ?? "Contato";

  for (const decision of decisions.filter((d) => d.escalated)) {
    const clientName = nameOf(decision.clientId);
    const isRisk = decision.classification === "POSSIBLE_RISK";

    push({
      organizationId,
      ...stamp(decision.decidedAt),
      type: isRisk ? "POSSIBLE_RISK_DETECTED" : "CLIENT_WAITING",
      priority: decision.attention,
      status: "UNREAD",
      // O nome no titulo e o que torna o alerta acionavel de relance: sem ele,
      // varios alertas do mesmo tipo ficam indistinguiveis na lista.
      title: isRisk
        ? `Possível risco: ${clientName}`
        : `${clientName} aguarda resposta`,
      body: decision.reason,
      professionalId: decision.professionalId,
      target: { type: "conversation", id: decision.conversationId },
      channels: ["DASHBOARD"],
      aiDecisionId: decision.id,
      acknowledgedBy: null,
      acknowledgedAt: null,
    });
  }

  const cancelled = appointments.filter(
    (appointment) =>
      appointment.status === "CANCELLED" && appointment.startsAt > now,
  );
  for (const appointment of cancelled.slice(0, 2)) {
    push({
      organizationId,
      ...stamp(now),
      type: "APPOINTMENT_CANCELLED",
      priority: "ATTENTION",
      status: "UNREAD",
      title: "Atendimento cancelado",
      body: `${appointment.clientName} cancelou o horário de ${appointment.startsAt.slice(11, 16)}.`,
      professionalId: appointment.professionalId,
      target: { type: "appointment", id: appointment.id },
      channels: ["DASHBOARD"],
      aiDecisionId: null,
      acknowledgedBy: null,
      acknowledgedAt: null,
    });
  }

  const overdue = transactions.filter(
    (transaction) => transaction.status === "OVERDUE",
  );
  for (const transaction of overdue.slice(0, 2)) {
    push({
      organizationId,
      ...stamp(now),
      type: "PAYMENT_OVERDUE",
      priority: "ATTENTION",
      status: "READ",
      title: "Pagamento em atraso",
      body: `${transaction.clientName} está com pagamento pendente.`,
      professionalId: transaction.professionalId,
      target: { type: "transaction", id: transaction.id },
      channels: ["DASHBOARD"],
      aiDecisionId: null,
      acknowledgedBy: null,
      acknowledgedAt: null,
    });
  }

  push({
    organizationId,
    ...stamp(atTime(shiftDays(today, -1), 9)),
    type: "NEW_CLIENT",
    priority: "NORMAL",
    status: "READ",
    title: "Novo cadastro",
    body: "Um novo contato foi cadastrado a partir do formulário do site.",
    professionalId: "prof-owner",
    target: null,
    channels: ["DASHBOARD"],
    aiDecisionId: null,
    acknowledgedBy: null,
    acknowledgedAt: null,
  });

  return notifications;
}

export function buildAuditLogs(
  ctx: GeneratorContext,
  rules: AIRule[],
  decisions: AIDecision[],
): AuditLog[] {
  const { organizationId, today } = ctx;
  const logs: AuditLog[] = [];
  let sequence = 0;

  const push = (log: Omit<AuditLog, "id">) => {
    sequence += 1;
    logs.push({ ...log, id: `audit-${sequence}` });
  };

  for (const decision of decisions.slice(0, 8)) {
    push({
      organizationId,
      ...stamp(decision.decidedAt),
      actorType: "AI_AGENT",
      actorId: null,
      actorName: AI_ASSISTANT_NAME,
      action:
        decision.action === "AUTO_RESPONSE"
          ? "AI_AUTO_RESPONSE"
          : "AI_ESCALATION",
      resource: { type: "conversation", id: decision.conversationId },
      summary: decision.reason,
      metadata: {
        classification: decision.classification,
        confidence: decision.confidence,
        rules: decision.appliedRules.length,
      },
      occurredAt: decision.decidedAt,
    });
  }

  const editableRule = rules.find((rule) => !rule.immutable);
  if (editableRule) {
    push({
      organizationId,
      ...stamp(atTime(shiftDays(today, -3), 16, 20)),
      actorType: "USER",
      actorId: "demo-user",
      actorName: "Você",
      action: "RULE_ENABLED",
      resource: { type: "aiRule", id: editableRule.id },
      summary: `Regra "${editableRule.name}" ativada.`,
      metadata: { level: editableRule.level, version: editableRule.version },
      occurredAt: atTime(shiftDays(today, -3), 16, 20),
    });
  }

  push({
    organizationId,
    ...stamp(atTime(shiftDays(today, -5), 8, 5)),
    actorType: "USER",
    actorId: "demo-user",
    actorName: "Você",
    action: "LOGIN",
    resource: { type: "session", id: "demo-user" },
    summary: "Acesso ao painel.",
    metadata: {},
    occurredAt: atTime(shiftDays(today, -5), 8, 5),
  });

  return logs.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
