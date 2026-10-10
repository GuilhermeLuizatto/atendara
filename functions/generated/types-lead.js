// Gerado por scripts/build-functions.mjs.
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
];
/** Por onde o contato chegou. Hoje só o WhatsApp recebe mensagem de fora. */
export const LEAD_SOURCES = ["WHATSAPP"];
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
];
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
];
