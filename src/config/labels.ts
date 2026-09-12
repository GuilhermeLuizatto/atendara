import type {
  AcquisitionChannel,
  AIActionTaken,
  AppointmentStatus,
  AttentionLevel,
  AuditAction,
  AuditActorType,
  ClientStatus,
  ConversationStatus,
  MessageChannel,
  NotificationType,
  OrganizationKind,
  PaymentMethod,
  PlanTier,
  RuleCategory,
  RuleLevel,
  ServiceModality,
  TransactionStatus,
} from "@/types";

/**
 * Rotulos de exibicao em pt-BR.
 *
 * O dominio guarda enums em ingles; a traducao vive aqui. Isso mantem os dados
 * estaveis e concentra a internacionalizacao futura em um unico ponto.
 */

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  COMPLETED: "Realizado",
  CANCELLED: "Cancelado",
  NO_SHOW: "Faltou",
  RESCHEDULED: "Remarcado",
};

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  LEAD: "Interessado",
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  ON_HOLD: "Pausado",
  DISCHARGED: "Alta",
};

export const MODALITY_LABELS: Record<ServiceModality, string> = {
  IN_PERSON: "Presencial",
  ONLINE: "Online",
  HOME_VISIT: "Domiciliar",
  HYBRID: "Híbrido",
};

export const CHANNEL_LABELS: Record<MessageChannel, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "E-mail",
  WEB_CHAT: "Chat do site",
  INSTAGRAM: "Instagram",
  INTERNAL: "Interno",
};

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: "Aberta",
  WAITING_PROFESSIONAL: "Aguardando profissional",
  WAITING_CLIENT: "Aguardando cliente",
  RESOLVED: "Resolvida",
  ARCHIVED: "Arquivada",
};

export const ATTENTION_LABELS: Record<AttentionLevel, string> = {
  NORMAL: "Normal",
  ATTENTION: "Atenção",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: "Criação",
  UPDATE: "Alteração",
  DELETE: "Exclusão",
  READ_SENSITIVE: "Leitura de dado sensível",
  LOGIN: "Entrada",
  LOGOUT: "Saída",
  RULE_ENABLED: "Regra ativada",
  RULE_DISABLED: "Regra desativada",
  AI_AUTO_RESPONSE: "Resposta automática",
  AI_ESCALATION: "Encaminhamento ao profissional",
  PERMISSION_CHANGED: "Permissão alterada",
  EXPORT: "Exportação",
};

export const AUDIT_ACTOR_LABELS: Record<AuditActorType, string> = {
  USER: "Pessoa da equipe",
  AI_AGENT: "Agente",
  SYSTEM: "Sistema",
};

/** Tipo de registro afetado. Tipo desconhecido aparece como foi gravado. */
export const AUDIT_RESOURCE_LABELS: Record<string, string> = {
  organization: "Organização",
  client: "Cadastro",
  appointment: "Atendimento",
  transaction: "Lançamento",
  rule: "Regra do agente",
  conversation: "Conversa",
  message: "Mensagem",
  aiDecision: "Decisão do agente",
  notification: "Alerta",
  notificationDelivery: "Aviso ao cliente",
  privacyRequest: "Pedido de titular",
};

/** 0 = domingo, como `AgendaSettings.workingDays`. */
export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  PENDING: "Pendente",
  PAID: "Pago",
  OVERDUE: "Atrasado",
  CANCELLED: "Cancelado",
  REFUNDED: "Estornado",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: "Pix",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BANK_TRANSFER: "Transferência",
  CASH: "Dinheiro",
  INSURANCE: "Convênio",
  OTHER: "Outro",
};

export const ACQUISITION_CHANNEL_LABELS: Record<AcquisitionChannel, string> = {
  REFERRAL: "Indicação",
  INSTAGRAM: "Instagram",
  GOOGLE: "Google",
  WHATSAPP: "WhatsApp",
  WEBSITE: "Site",
  OTHER: "Outro",
};

export const ORGANIZATION_KIND_LABELS: Record<OrganizationKind, string> = {
  SOLO_PRACTITIONER: "Profissional autônomo",
  CLINIC: "Clínica",
  OFFICE: "Consultório",
  STUDIO: "Estúdio",
  GYM: "Academia",
  TEAM: "Equipe",
};

export const PLAN_LABELS: Record<PlanTier, string> = {
  TRIAL: "Avaliação",
  SOLO: "Individual",
  CLINIC: "Clínica",
  ENTERPRISE: "Corporativo",
};

export const RULE_LEVEL_LABELS: Record<RuleLevel, string> = {
  SECURITY: "Segurança do sistema",
  SYSTEM: "Regra fundamental",
  PROFESSION: "Regra da profissão",
  PROFESSIONAL: "Regra do profissional",
  CONTEXTUAL: "Regra contextual",
  PREFERENCE: "Preferência de comunicação",
};

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  SAFETY: "Segurança",
  IDENTITY: "Identidade",
  PRIVACY: "Privacidade",
  PRICING: "Preços",
  SCHEDULING: "Agendamento",
  CONFIRMATION: "Confirmação",
  RESCHEDULING: "Remarcação",
  CANCELLATION: "Cancelamento",
  LOCATION: "Localização",
  AVAILABILITY: "Disponibilidade",
  SERVICES: "Serviços",
  PAYMENT: "Pagamento",
  ESCALATION: "Escalonamento",
  TONE: "Tom de voz",
  GENERAL: "Geral",
};

export const AI_ACTION_LABELS: Record<AIActionTaken, string> = {
  AUTO_RESPONSE: "Respondido",
  SUGGEST_RESPONSE: "Sugestão pronta",
  ESCALATE_TO_PROFESSIONAL: "Encaminhado a você",
  CREATE_ALERT: "Alerta gerado",
  NO_ACTION: "Sem ação",
  BLOCKED: "Bloqueado",
};

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  POSSIBLE_RISK_DETECTED: "Possível risco",
  NEW_MESSAGE: "Nova mensagem",
  CLIENT_WAITING: "Cliente aguardando",
  APPOINTMENT_CANCELLED: "Cancelamento",
  APPOINTMENT_CONFIRMED: "Confirmação",
  NEW_CLIENT: "Novo cadastro",
  PAYMENT_OVERDUE: "Pagamento atrasado",
  AUTOMATION_FAILURE: "Falha de automação",
  RULE_CHANGED: "Regra alterada",
};
