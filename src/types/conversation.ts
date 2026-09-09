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
  clientId: ID;
  clientName: string;
  professionalId: ID | null;
  channel: MessageChannel;
  status: ConversationStatus;
  attention: AttentionLevel;
  /** Classificacao da mensagem mais recente do cliente. */
  lastClassification: MessageClassificationId | null;
  lastMessagePreview: string;
  lastMessageAt: ISODateString;
  unreadCount: number;
  /** True quando o agente parou de atuar e aguarda o profissional. */
  escalated: boolean;
  escalationReason: string | null;
}

export interface Message extends TenantScopedEntity {
  conversationId: ID;
  clientId: ID;
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
