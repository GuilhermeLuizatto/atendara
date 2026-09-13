import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { PrivacyRedactionMark } from "./privacy";

/**
 * Avisos que SAEM do produto — distintos de `notification.ts`, que e o alerta
 * exibido dentro do painel.
 *
 * O modelo separa duas coisas que nao podem se misturar:
 *
 * 1. **`PLATFORM_TO_SUBSCRIBER`** — a operadora avisando o assinante sobre a
 *    propria assinatura (teste acabando, pagamento recusado, acesso vencendo).
 *    Deriva de `platformSubscriptions` e hoje aparece so dentro do painel.
 * 2. **`ORGANIZATION_TO_CLIENT`** — a clinica avisando quem ela atende sobre um
 *    atendimento. Sai da organizacao, exige canal configurado, consentimento e
 *    contato valido, e e o unico dos dois que produz `NotificationDelivery`.
 *
 * Um aviso de mensalidade nunca vira mensagem de clinica, e um lembrete de
 * atendimento nunca sai em nome da operadora — sao audiencias, remetentes e
 * bases legais diferentes.
 */
export type NotificationAudience =
  | "PLATFORM_TO_SUBSCRIBER"
  | "ORGANIZATION_TO_CLIENT";

/**
 * Canais de saida da organizacao. `IN_APP` nao entra: aviso dentro do painel e
 * `Notification`, nao envio — e nao precisa de consentimento nem de contato.
 */
export const OUTBOUND_CHANNELS = ["EMAIL", "SMS", "WHATSAPP"] as const;

export type OutboundChannel = (typeof OUTBOUND_CHANNELS)[number];

/** Eventos da agenda que podem gerar aviso ao cliente. */
export const APPOINTMENT_NOTIFICATION_EVENTS = [
  "APPOINTMENT_SCHEDULED",
  "APPOINTMENT_REMINDER",
  "APPOINTMENT_CONFIRMED",
  "APPOINTMENT_CANCELLED",
] as const;

export type AppointmentNotificationEvent =
  (typeof APPOINTMENT_NOTIFICATION_EVENTS)[number];

/**
 * Uma regra e a unica coisa que autoriza um envio. Sem regra habilitada para o
 * par evento+canal, nenhuma acao da agenda produz mensagem — inclusive
 * confirmar um atendimento.
 */
export interface NotificationRule {
  id: ID;
  event: AppointmentNotificationEvent;
  channel: OutboundChannel;
  /** Desligada por padrao. Ver `DEFAULT_NOTIFICATION_SETTINGS`. */
  enabled: boolean;
  /** Antecedencia em minutos. `0` = no proprio instante do evento. */
  leadMinutes: number;
  /** `null` = usa o modelo da profissao (`definitions.ts`). */
  customTemplate: string | null;
}

export interface OrganizationNotificationSettings {
  /**
   * Trava mestra da organizacao. Desligada, nenhuma regra vale — e o unico
   * campo que precisa ser conferido antes de qualquer coisa.
   */
  enabled: boolean;
  /**
   * A organizacao comprovou habilitacao como remetente naquele canal (numero
   * aprovado no provedor, dominio verificado). Ter um contato NAO e comprovar
   * isso: e por essa distincao que existem dois campos.
   */
  verifiedSenderChannels: OutboundChannel[];
  rules: NotificationRule[];
}

/**
 * Quem pos o registro no sistema. `STAFF` e alguem da equipe anotando o que a
 * pessoa autorizou; `SUBJECT` e a propria pessoa, por um caminho do backend
 * (link ou resposta pelo canal). As Security Rules so aceitam `STAFF` com o
 * uid de quem escreve: o navegador nao afirma que a pessoa registrou sozinha.
 */
export const CONSENT_RECORDER_KINDS = ["STAFF", "SUBJECT"] as const;

export type ConsentRecorderKind = (typeof CONSENT_RECORDER_KINDS)[number];

/** Por onde a pessoa se manifestou, ao autorizar ou ao retirar. */
export const CONSENT_MEDIA = ["FORM", "WRITTEN_DOCUMENT", "MESSAGE"] as const;

export type ConsentMedium = (typeof CONSENT_MEDIA)[number];

/** LGPD, art. 14: um dos pais ou o responsavel legal. */
export const LEGAL_GUARDIAN_RELATIONSHIPS = ["PARENT", "LEGAL_GUARDIAN"] as const;

export type LegalGuardianRelationship = (typeof LEGAL_GUARDIAN_RELATIONSHIPS)[number];

export interface ConsentRecorder {
  kind: ConsentRecorderKind;
  /** uid de quem da equipe registrou. `null` quando foi a propria pessoa. */
  userId: ID | null;
}

/** Um ato sobre o consentimento: autorizar ou retirar. */
export interface ConsentAct {
  at: ISODateString;
  recordedBy: ConsentRecorder;
  medium: ConsentMedium;
}

export interface LegalGuardian {
  fullName: string;
  relationship: LegalGuardianRelationship;
}

/**
 * Um consentimento dado para UM canal, do inicio ao fim.
 *
 * Retirar preenche `withdrawn` e nao apaga nada; autorizar de novo acrescenta
 * outro registro. Cada registro guarda a versao do texto que valia quando foi
 * dado — a de agora pode ser outra.
 */
export interface ChannelConsentRecord {
  granted: ConsentAct;
  /** `NOTIFICATION_CONSENT_TEXT_VERSION` mostrada a pessoa ao autorizar. */
  textVersion: string;
  /** Menor de idade: quem autoriza e o responsavel legal, e ele e obrigatorio. */
  subjectIsMinor: boolean;
  legalGuardian: LegalGuardian | null;
  withdrawn: ConsentAct | null;
}

/**
 * Consentimento do titular, por canal, com historico.
 *
 * `Client.appointmentNotificationsEnabled` continua sendo o "aceito receber
 * avisos" geral; este objeto diz PARA QUAL CANAL, quando, com qual texto, quem
 * registrou, por qual meio e, para menor, com qual responsavel. O aceite geral e
 * o registro completo do canal sao exigidos juntos.
 *
 * `channels[canal]` vai do registro mais antigo ao atual; o ultimo e o que vale.
 */
export interface NotificationConsent {
  formatVersion: 2;
  channels: Partial<Record<OutboundChannel, ChannelConsentRecord[]>>;
  /**
   * O consentimento anterior a este formato, guardado como estava quando o
   * cadastro passou a usar o registro por canal. Nao autoriza envio: nao diz
   * quem registrou, nem por qual meio, nem a data de cada canal.
   */
  legacy: LegacyNotificationConsent | null;
}

/** Formato anterior ao registro por canal. So existe em cadastro antigo. */
export interface LegacyNotificationConsent {
  channels: OutboundChannel[];
  grantedAt: ISODateString;
  revokedAt: ISODateString | null;
  source: "CLIENT_FORM" | "WRITTEN" | "IMPORTED";
  textVersion?: string | null;
}

/** O que um documento de cadastro pode trazer no campo de consentimento. */
export type StoredNotificationConsent = NotificationConsent | LegacyNotificationConsent;

/**
 * Estados de entrega.
 *
 * `PLANNED` -> `SENDING` -> `SENT` | `FAILED`; `CANCELLED` fecha o registro
 * quando o atendimento deixa de existir antes da hora do envio. `FAILED` so e
 * terminal depois de esgotadas as tentativas; ate la volta para `PLANNED` com
 * `nextAttemptAt` no futuro. `SENDING` e o intervalo em que o despachante do
 * backend adquiriu a tarefa e ainda nao gravou o resultado.
 */
export type DeliveryStatus =
  | "PLANNED"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "CANCELLED";

/** O que o provedor respondeu. Nao inclui conteudo da mensagem. */
export type DeliveryOutcome = "ACCEPTED" | "TEMPORARY_FAILURE" | "REJECTED";

export const DELIVERY_FAILURE_CODES = [
  "PROVIDER_UNAVAILABLE",
  "INVALID_DESTINATION",
  "RATE_LIMITED",
  "SENDER_NOT_ALLOWED",
  "ATTEMPTS_EXHAUSTED",
  // A execucao morreu depois de adquirir a tarefa e antes de gravar o
  // resultado. Nao ganha nova tentativa: o envio pode ter saido.
  "DISPATCH_INTERRUPTED",
] as const;

export type DeliveryFailureCode = (typeof DELIVERY_FAILURE_CODES)[number];

/**
 * Registro de resultado.
 *
 * O que NAO existe aqui e deliberado: nem o texto enviado, nem o nome de quem
 * recebeu, nem o contato completo, nem qualquer dado do atendimento alem do
 * identificador. Auditar entrega exige saber "o que foi tentado, quando, por
 * qual canal e com que resultado" — nao exige guardar a mensagem. `bodyHash`
 * permite provar que duas tentativas mandaram o mesmo texto sem guardar texto
 * nenhum.
 */
export interface NotificationDelivery extends TenantScopedEntity {
  audience: "ORGANIZATION_TO_CLIENT";
  event: AppointmentNotificationEvent;
  channel: OutboundChannel;
  ruleId: ID;
  appointmentId: ID;
  clientId: ID;
  professionalId: ID | null;
  /** Instante em que o envio deve ocorrer (evento menos antecedencia). */
  scheduledFor: ISODateString;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt: ISODateString | null;
  /** `null` quando nao ha nova tentativa prevista. */
  nextAttemptAt: ISODateString | null;
  /** Identificador do provedor. `SIMULATED` enquanto nao houver canal real. */
  providerId: string;
  providerMessageId: string | null;
  failureCode: DeliveryFailureCode | null;
  templateId: string;
  bodyHash: string;
  bodyLength: number;
  /** Ultimos digitos/caracteres do destino, para conferencia sem expor contato. */
  contactHint: string;
  sentAt: ISODateString | null;
  cancelledAt: ISODateString | null;
  privacyRedaction?: PrivacyRedactionMark | null;
}

/** Por que um evento da agenda nao produziu envio. */
export const NOTIFICATION_SKIP_REASONS = [
  "ORGANIZATION_DISABLED",
  "SENDER_NOT_VERIFIED",
  "NO_RULE_FOR_EVENT",
  "RULE_DISABLED",
  "EVENT_NOT_ALLOWED_FOR_PROFESSION",
  "CHANNEL_NOT_ALLOWED_FOR_PROFESSION",
  "EVENT_WITHOUT_AUTOMATION",
  "MISSING_CONTACT",
  "INVALID_CONTACT",
  "MISSING_CONSENT",
  "CONSENT_REVOKED",
  "CHANNEL_NOT_CONSENTED",
  "CONSENT_INCOMPLETE",
  "SCHEDULE_IN_THE_PAST",
  "ALREADY_PLANNED",
  "TEMPLATE_REJECTED",
] as const;

export type NotificationSkipReason =
  (typeof NOTIFICATION_SKIP_REASONS)[number];

/** Resultado da avaliacao de uma regra contra um evento concreto. */
export type NotificationEligibility =
  | { eligible: true; scheduledFor: ISODateString; body: string }
  | { eligible: false; reason: NotificationSkipReason };

/**
 * Por que um aviso ja planejado nao foi enviado. Alem das travas do
 * planejamento, o que so da para saber na hora: a regra sumiu, o atendimento
 * foi cancelado, remarcado ou passou para outro cadastro, ou o texto mudou.
 */
export const NOTIFICATION_DISPATCH_ONLY_STOP_REASONS = [
  "RULE_NOT_FOUND",
  "APPOINTMENT_NOT_FOUND",
  "APPOINTMENT_CANCELLED",
  "APPOINTMENT_RESCHEDULED",
  "APPOINTMENT_CLIENT_CHANGED",
  "CLIENT_NOT_FOUND",
  "BODY_CHANGED",
] as const;

export type NotificationDispatchOnlyStopReason =
  (typeof NOTIFICATION_DISPATCH_ONLY_STOP_REASONS)[number];

export type NotificationDispatchStopReason =
  | NotificationSkipReason
  | NotificationDispatchOnlyStopReason;

// ------------------------------------------------ avisos da plataforma

export const PLATFORM_NOTICE_EVENTS = [
  "TRIAL_ENDING",
  "PAYMENT_PENDING",
  "ACCESS_ENDING",
  "SUBSCRIPTION_CANCELED",
  "NO_SUBSCRIPTION",
] as const;

export type PlatformNoticeEvent = (typeof PLATFORM_NOTICE_EVENTS)[number];

/**
 * Aviso da operadora ao assinante.
 *
 * E derivado da assinatura a cada leitura, nao gravado: o estado ja e escrito
 * exclusivamente pelo webhook (AGENTS.md, regra 10), e um aviso persistido
 * seria uma segunda copia da mesma verdade, livre para divergir. Hoje o canal e
 * sempre `IN_APP`; e-mail depende de ativacao futura.
 */
export interface PlatformNotice {
  event: PlatformNoticeEvent;
  severity: "INFO" | "ATTENTION" | "CRITICAL";
  channel: "IN_APP";
  title: string;
  body: string;
  actionLabel: string | null;
  actionHref: string | null;
}
