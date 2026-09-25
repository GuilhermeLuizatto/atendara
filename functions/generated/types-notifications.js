// Gerado por scripts/build-functions.mjs.
/**
 * Canais de saida da organizacao. `IN_APP` nao entra: aviso dentro do painel e
 * `Notification`, nao envio — e nao precisa de consentimento nem de contato.
 */
export const OUTBOUND_CHANNELS = ["EMAIL", "SMS", "WHATSAPP"];
/** Mudancas da agenda que podem gerar aviso ao cliente. */
export const AGENDA_NOTICE_EVENTS = [
    "APPOINTMENT_SCHEDULED",
    "APPOINTMENT_REMINDER",
    "APPOINTMENT_CONFIRMED",
    "APPOINTMENT_CANCELLED",
];
/**
 * Respostas da assistente a um pedido que a propria pessoa fez pelo canal.
 *
 * **Sao avisos como os outros** (decisao do titular, 24/09): passam pelas
 * mesmas travas da regra 11 — regra habilitada, remetente, profissao,
 * consentimento que nomeie o canal e contato. O que muda e o gatilho: nenhuma
 * mudanca da agenda as planeja; so a conversa, e so dentro da janela que a
 * pessoa abriu.
 */
export const CONVERSATION_REPLY_EVENTS = [
    "RESCHEDULE_OFFERED",
    "RESCHEDULE_CONFIRMED",
    "RESCHEDULE_HANDED_OFF",
];
/** Tudo o que uma regra de aviso pode autorizar. */
export const APPOINTMENT_NOTIFICATION_EVENTS = [
    ...AGENDA_NOTICE_EVENTS,
    ...CONVERSATION_REPLY_EVENTS,
];
/**
 * Em que ponto do pedido a resposta sai: ao receber o pedido (`REQUEST`) ou
 * depois da escolha de um horario oferecido (`CHOICE`).
 */
export const REPLY_STAGES = ["REQUEST", "CHOICE"];
export function isConversationReplyEvent(event) {
    return CONVERSATION_REPLY_EVENTS.includes(event);
}
/**
 * Situacao do remetente no provedor. `APPROVED` e o unico estado que deixa
 * mensagem sair: `PENDING` e verificacao em andamento na Meta e `REJECTED` e
 * recusa, que exige agir no painel do provedor antes de tentar de novo.
 */
export const MESSAGING_SENDER_STATUSES = ["PENDING", "APPROVED", "REJECTED"];
/**
 * Em `TEST`, o provedor so entrega a numeros cadastrados como testadores, e o
 * Atendara recusa antes de tentar: o erro do provedor viria tarde demais, e
 * cada tentativa recusada conta contra a reputacao do remetente.
 */
export const MESSAGING_SENDER_MODES = ["TEST", "PRODUCTION"];
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
    // Agenda Google (3C): a autorizacao caiu, ou a agenda "Atendara" nao existe.
    "CALENDAR_RECONNECT_REQUIRED",
    "CALENDAR_NOT_PROVISIONED",
];
/** Por que um evento da agenda nao produziu envio. */
export const NOTIFICATION_SKIP_REASONS = [
    "ORGANIZATION_DISABLED",
    "SENDER_NOT_VERIFIED",
    // Canal real sem cadastro de remetente feito pela operadora (13.4). A
    // organizacao pode ter marcado o canal como comprovado na propria
    // configuracao; isso nao basta quando quem entrega e um provedor de verdade.
    "SENDER_NOT_REGISTERED",
    // Cadastro existe, mas a Meta ainda nao aprovou — ou recusou — o remetente.
    "SENDER_NOT_APPROVED",
    // Remetente em modo de teste: o provedor so entrega a numeros cadastrados
    // como testadores, e tentar fora da lista so gera recusa.
    "DESTINATION_NOT_IN_TEST_LIST",
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
    // Respostas na conversa: sem cadastro identificado nao ha consentimento a
    // conferir, e resposta nao sai para "quem quer que seja" daquele numero.
    "CLIENT_NOT_IDENTIFIED",
    // Conversa assumida por gente ou marcada como critica: automacao se cala.
    "CONVERSATION_WITH_HUMAN",
    // Fora das 24 horas que a pessoa abriu, a Meta so aceita modelo aprovado.
    "REPLY_WINDOW_CLOSED",
    // A resposta perdeu o sentido: oferta de horario cuja reserva ja venceu.
    "REPLY_EXPIRED",
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
    // Resposta na conversa: a oferta de horarios ja foi respondida, substituida
    // ou encerrada antes de a mensagem sair. Mostra-la agora seria oferecer o que
    // nao esta mais segurado.
    "OFFER_CLOSED",
];
// ------------------------------------------------ avisos da plataforma
export const PLATFORM_NOTICE_EVENTS = [
    "TRIAL_ENDING",
    "PAYMENT_PENDING",
    "ACCESS_ENDING",
    "SUBSCRIPTION_CANCELED",
    "NO_SUBSCRIPTION",
];
