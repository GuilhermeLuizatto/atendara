import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { AttentionLevel } from "./conversation";
import type { NotificationConsent } from "./notifications";
import type { PrivacyRedactionMark } from "./privacy";

/**
 * Lead: quem escreveu para a organização sem ter cadastro nela.
 *
 * Não é cliente e não vira cliente sozinho. Guarda o mínimo para a equipe
 * responder e para a Dara saber se pode falar: canal de origem, telefone,
 * conversa, fila e consentimento. Nome, texto da mensagem e qualquer conteúdo
 * clínico ficam fora — a conversa é o único lugar do que foi dito.
 *
 * Transpilado para `functions/generated/types-lead.js`.
 */

/**
 * `NEW`: registrado, sem pedido de atenção humana. `WAITING_TEAM`: precisa de
 * alguém da equipe. `TAKEN_OVER`: a equipe assumiu a conversa. `CLOSED`:
 * encerrado pela equipe.
 */
export const LEAD_STATUSES = [
  "NEW",
  "WAITING_TEAM",
  "TAKEN_OVER",
  "CLOSED",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Por onde o contato chegou. Hoje só o WhatsApp recebe mensagem de fora. */
export const LEAD_SOURCES = ["WHATSAPP"] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * Filas internas do encaminhamento. `TENANT_FINANCE` é o financeiro DA
 * organização (`transactions`); a mensalidade do Atendara não tem fila aqui.
 */
export const ROUTING_QUEUES = [
  "AGENDA",
  "TENANT_FINANCE",
  "COMMERCIAL",
  "ADMINISTRATIVE_SUPPORT",
  "HUMAN_REVIEW",
] as const;

export type RoutingQueue = (typeof ROUTING_QUEUES)[number];

/** Motivo do encaminhamento: código fechado, nunca trecho da mensagem. */
export const ROUTING_REASONS = [
  "AGENDA_REQUEST",
  "FINANCIAL_SUBJECT",
  "COMMERCIAL_QUESTION",
  "ADMINISTRATIVE_QUESTION",
  "POSSIBLE_RISK",
  "URGENCY",
  "SENSITIVE_CONTENT",
  "AMBIGUOUS",
  "LOW_CONFIDENCE",
  "MISSING_CONTEXT",
] as const;

export type RoutingReason = (typeof ROUTING_REASONS)[number];

export interface RoutingDecision {
  queue: RoutingQueue;
  reason: RoutingReason;
  /** O encaminhamento exige gente: a Dara não resolve sozinha. */
  requiresHuman: boolean;
}

/** Como o consentimento do WhatsApp está, para a equipe ver de relance. */
export type LeadConsentState = "ABSENT" | "GRANTED" | "WITHDRAWN" | "OUTDATED";

export interface Lead extends TenantScopedEntity {
  source: LeadSource;
  /** Conversa do contato. Id aleatório: não carrega o telefone. */
  conversationId: ID;
  /** E.164. É o destino da resposta, e só sai com consentimento vigente. */
  phone: string;
  /** Últimos dígitos, para a lista não virar agenda de contatos. */
  contactHint: string;
  /** Profissional responsável, quando o contexto basta para saber. */
  professionalId: ID | null;
  status: LeadStatus;
  queue: RoutingQueue;
  routingReason: RoutingReason;
  attention: AttentionLevel;
  firstContactAt: ISODateString;
  /** Instante da mensagem mais nova aplicada. Nunca anda para trás. */
  lastContactAt: ISODateString;
  statusChangedAt: ISODateString;
  /** Mesmo formato do cadastro, só com registros dados pela própria pessoa. */
  notificationConsent: NotificationConsent | null;
  privacyRedaction?: PrivacyRedactionMark | null;
}
