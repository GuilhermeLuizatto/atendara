import type { BaseEntity, CurrencyCode, ID } from "./common";
import type { OrganizationNotificationSettings } from "./notifications";
import type { ProfessionId, ServiceModality } from "./profession";

/**
 * A organizacao e a unidade de isolamento (tenant). Um profissional autonomo
 * tambem possui uma organizacao — de um unico membro. Isso evita dois modelos
 * de dados distintos e permite que "autonomo vira clinica" seja apenas o
 * convite de novos membros.
 */
export type OrganizationKind =
  "SOLO_PRACTITIONER" | "CLINIC" | "OFFICE" | "STUDIO" | "GYM" | "TEAM";

export type PlanTier = "TRIAL" | "SOLO" | "CLINIC" | "ENTERPRISE";

export interface AgendaSettings {
  /** 0 = domingo ... 6 = sabado. */
  workingDays: number[];
  workdayStart: string; // "08:00"
  workdayEnd: string; // "18:00"
  slotIntervalMinutes: number;
  defaultModality: ServiceModality;
  allowDoubleBooking: boolean;
}

export interface AIAgentSettings {
  enabled: boolean;
  /** Nome exibido do assistente nas conversas. */
  displayName: string;
  /**
   * Confianca minima para resposta automatica. Abaixo disso o agente escala,
   * mesmo que uma regra do profissional autorize o topico.
   */
  autoResponseConfidenceThreshold: number;
  /** Se falso, o agente sempre sugere e nunca envia sozinho. */
  allowAutonomousReplies: boolean;
  /** Janela de silencio: fora dela o agente apenas registra e nao responde. */
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export interface PrivacySettings {
  /** Retencao de mensagens em dias. `null` = indefinido (exige revisao). */
  messageRetentionDays: number | null;
  /** Retencao de logs de auditoria em dias. */
  auditRetentionDays: number;
  /**
   * Impede que o agente copie conteudo de conversas para o CRM. Ligado por
   * padrao: o MVP e um CRM administrativo, nao um prontuario.
   */
  blockConversationToCrmCopy: boolean;
}

export interface OrganizationSettings {
  agenda: AgendaSettings;
  ai: AIAgentSettings;
  privacy: PrivacySettings;
  /**
   * Avisos que a organizacao envia a quem ela atende. Nasce inteiramente
   * desligado; ver `DEFAULT_NOTIFICATION_SETTINGS` em `src/config/notifications`.
   */
  notifications: OrganizationNotificationSettings;
}

export interface Organization extends BaseEntity {
  name: string;
  slug: string;
  kind: OrganizationKind;
  /** Profissao que define a terminologia e os defaults da interface. */
  primaryProfession: ProfessionId;
  /** Clinicas multidisciplinares podem habilitar mais de uma profissao. */
  professions: ProfessionId[];
  /** Endereco de atendimento. O agente pode informa-lo quando autorizado. */
  address: string | null;
  timezone: string;
  locale: string;
  currency: CurrencyCode;
  plan: PlanTier;
  ownerId: ID;
  settings: OrganizationSettings;
}
