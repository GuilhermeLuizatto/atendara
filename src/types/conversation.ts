import type { MessageClassificationId } from "./classification";
import type { ID, ISODateString, TenantScopedEntity } from "./common";

export type MessageChannel =
  "WHATSAPP" | "SMS" | "EMAIL" | "WEB_CHAT" | "INSTAGRAM" | "INTERNAL";

export type ConversationStatus =
  "OPEN" | "WAITING_PROFESSIONAL" | "WAITING_CLIENT" | "RESOLVED" | "ARCHIVED";

export type MessageDirection = "INBOUND" | "OUTBOUND";

export type MessageAuthorType =
  "CLIENT" | "PROFESSIONAL" | "AI_AGENT" | "SYSTEM";

export type AttentionLevel = "NORMAL" | "ATTENTION" | "HIGH" | "CRITICAL";

export interface Conversation extends TenantScopedEntity {
  clientId: ID | null;
  clientName: string;
  professionalId: ID | null;
  channel: MessageChannel;
  status: ConversationStatus;
  attention: AttentionLevel;
  /** Classificacao da mensagem mais recente do cliente. */
  lastClassification: MessageClassificationId | null;
  lastMessagePreview: string;
  lastMessageAt: ISODateString;
  lastInboundAt?: ISODateString;
  inboundWindowEndsAt?: ISODateString;
  unreadCount: number;
  /** True quando o agente parou de atuar e aguarda o profissional. */
  escalated: boolean;
  escalationReason: string | null;
  /** Resposta administrativa ainda cancelável por uma resposta humana. */
  pendingAssistantTaskId?: ID | null;
  /** Lead dono da conversa, quando o número não tem cadastro. */
  leadId?: ID | null;
  /**
   * Quando e por onde a equipe assumiu. Assumir é ato humano; a Dara e os
   * webhooks nunca limpam este campo.
   */
  humanTakeoverAt?: ISODateString | null;
  humanTakeoverSource?: HumanTakeoverSource | null;
  /**
   * Registro da trilha que acompanhou a última retomada da automação. As
   * rules só aceitam devolver a conversa à Dara com esse registro gravado no
   * mesmo lote: retomar sem trilha é retomar em silêncio.
   */
  automationResumeAuditId?: ID | null;
}

export type HumanTakeoverSource = "PANEL" | "WHATSAPP_BUSINESS";

export interface Message extends TenantScopedEntity {
  conversationId: ID;
  clientId: ID | null;
  /** Repete o escopo da conversa para consultas `collectionGroup` seguras. */
  professionalId: ID | null;
  providerMessageId?: string;
  direction: MessageDirection;
  authorType: MessageAuthorType;
  authorName: string;
  channel: MessageChannel;
  body: string;
  sentAt: ISODateString;
  readAt: ISODateString | null;
  classification: MessageClassificationId | null;
  classificationConfidence: number | null;
  /** Decisao do motor de IA que originou ou avaliou esta mensagem. */
  aiDecisionId: ID | null;
}
