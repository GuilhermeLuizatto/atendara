import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { AttentionLevel } from "./conversation";
import type { PrivacyRedactionMark } from "./privacy";

export const NOTIFICATION_TYPES = [
  "POSSIBLE_RISK_DETECTED",
  "NEW_MESSAGE",
  "CLIENT_WAITING",
  "APPOINTMENT_CANCELLED",
  "APPOINTMENT_CONFIRMED",
  "NEW_CLIENT",
  "PAYMENT_OVERDUE",
  "AUTOMATION_FAILURE",
  "RULE_CHANGED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationStatus =
  "UNREAD" | "READ" | "ACKNOWLEDGED" | "RESOLVED";

/**
 * Canais de entrega. Apenas `DASHBOARD` esta implementado; os demais existem no
 * tipo para que a arquitetura de fan-out da Fase 3 nao mude o modelo de dados.
 */
export type NotificationChannel =
  "DASHBOARD" | "EMAIL" | "WHATSAPP" | "SMS" | "PUSH";

/** Recurso ao qual a notificacao aponta, para navegacao direta na interface. */
export interface NotificationTarget {
  type: "conversation" | "appointment" | "client" | "transaction" | "rule";
  id: ID;
}

export interface Notification extends TenantScopedEntity {
  type: NotificationType;
  priority: AttentionLevel;
  status: NotificationStatus;
  title: string;
  body: string;
  /** `null` = notificacao da organizacao inteira. */
  professionalId: ID | null;
  target: NotificationTarget | null;
  channels: NotificationChannel[];
  aiDecisionId: ID | null;
  acknowledgedBy: ID | null;
  acknowledgedAt: ISODateString | null;
  privacyRedaction?: PrivacyRedactionMark | null;
}
