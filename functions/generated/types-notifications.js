// Gerado por scripts/build-functions.mjs.
/**
 * Canais de saida da organizacao. `IN_APP` nao entra: aviso dentro do painel e
 * `Notification`, nao envio — e nao precisa de consentimento nem de contato.
 */
export const OUTBOUND_CHANNELS = ["EMAIL", "SMS", "WHATSAPP"];
/** Eventos da agenda que podem gerar aviso ao cliente. */
export const APPOINTMENT_NOTIFICATION_EVENTS = [
    "APPOINTMENT_SCHEDULED",
    "APPOINTMENT_REMINDER",
    "APPOINTMENT_CONFIRMED",
    "APPOINTMENT_CANCELLED",
];
/**
 * Quem pos o registro no sistema. `STAFF` e alguem da equipe anotando o que a
 * pessoa autorizou; `SUBJECT` e a propria pessoa, por um caminho do backend
 * (link ou resposta pelo canal). As Security Rules so aceitam `STAFF` com o
 * uid de quem escreve: o navegador nao afirma que a pessoa registrou sozinha.
 */
export const CONSENT_RECORDER_KINDS = ["STAFF", "SUBJECT"];
/** Por onde a pessoa se manifestou, ao autorizar ou ao retirar. */
export const CONSENT_MEDIA = ["FORM", "WRITTEN_DOCUMENT", "MESSAGE"];
/** LGPD, art. 14: um dos pais ou o responsavel legal. */
export const LEGAL_GUARDIAN_RELATIONSHIPS = ["PARENT", "LEGAL_GUARDIAN"];
export const DELIVERY_FAILURE_CODES = [
    "PROVIDER_UNAVAILABLE",
    "INVALID_DESTINATION",
    "RATE_LIMITED",
    "SENDER_NOT_ALLOWED",
    "ATTEMPTS_EXHAUSTED",
    // A execucao morreu depois de adquirir a tarefa e antes de gravar o
    // resultado. Nao ganha nova tentativa: o envio pode ter saido.
    "DISPATCH_INTERRUPTED",
];
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
];
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
];
// ------------------------------------------------ avisos da plataforma
export const PLATFORM_NOTICE_EVENTS = [
    "TRIAL_ENDING",
    "PAYMENT_PENDING",
    "ACCESS_ENDING",
    "SUBSCRIPTION_CANCELED",
    "NO_SUBSCRIPTION",
];
