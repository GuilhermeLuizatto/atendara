import type { ADMIN_INTENTS } from "@/config/ai-provider";
import { NOTIFICATION_CONSENT_TEXT_VERSION } from "@/config/notifications";
import type {
  LeadConsentState,
  LeadSource,
  LeadStatus,
  MessageClassificationId,
  RoutingDecision,
  RoutingQueue,
  RoutingReason,
} from "@/types";

/**
 * Primeiro contato pelo WhatsApp, como DADO.
 *
 * `lib/leads/` executa; este arquivo decide para qual fila cada assunto vai,
 * quem pode mover um lead e o que conta como consentimento dado pela própria
 * pessoa. Nenhuma profissão aparece aqui (regra 1): o encaminhamento usa a
 * taxonomia comum de classificação, e quem atende vem do cadastro.
 */

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "Novo",
  WAITING_TEAM: "Aguardando equipe",
  TAKEN_OVER: "Assumido",
  CLOSED: "Encerrado",
};

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  WHATSAPP: "WhatsApp",
};

export const ROUTING_QUEUE_LABELS: Record<RoutingQueue, string> = {
  AGENDA: "Agenda",
  TENANT_FINANCE: "Financeiro operacional",
  COMMERCIAL: "Primeiro atendimento comercial",
  ADMINISTRATIVE_SUPPORT: "Suporte administrativo",
  HUMAN_REVIEW: "Atendimento humano",
};

export const ROUTING_REASON_LABELS: Record<RoutingReason, string> = {
  AGENDA_REQUEST: "Pedido sobre horários",
  FINANCIAL_SUBJECT: "Assunto financeiro",
  COMMERCIAL_QUESTION: "Dúvida sobre valores ou serviços",
  ADMINISTRATIVE_QUESTION: "Dúvida administrativa",
  POSSIBLE_RISK: "Possível situação de risco",
  URGENCY: "Possível urgência",
  SENSITIVE_CONTENT: "Assunto que só a equipe pode tratar",
  AMBIGUOUS: "Mensagem ambígua",
  LOW_CONFIDENCE: "Classificação com baixa confiança",
  MISSING_CONTEXT: "Falta contexto para encaminhar",
};

export const LEAD_CONSENT_LABELS: Record<LeadConsentState, string> = {
  ABSENT: "Sem consentimento",
  GRANTED: "Consentimento vigente",
  WITHDRAWN: "Consentimento retirado",
  OUTDATED: "Consentimento de texto anterior",
};

type AdminIntent = (typeof ADMIN_INTENTS)[number];

const human = (reason: RoutingReason): RoutingDecision => ({
  queue: "HUMAN_REVIEW",
  reason,
  requiresHuman: true,
});

/**
 * Fila por classificação. `BY_INTENT` só vale para o administrativo: é a
 * única classificação em que a intenção diz algo sobre a fila — e a única que
 * a Dara pode responder (regra 4). Todo o resto vai para gente.
 */
export const CLASSIFICATION_ROUTING: Record<
  MessageClassificationId,
  RoutingDecision | "BY_INTENT"
> = {
  ADMINISTRATIVE: "BY_INTENT",
  PROFESSIONAL: human("SENSITIVE_CONTENT"),
  CLINICAL: human("SENSITIVE_CONTENT"),
  TRAINING: human("SENSITIVE_CONTENT"),
  HEALTH_RELATED: human("SENSITIVE_CONTENT"),
  URGENT: human("URGENCY"),
  FINANCIAL: {
    queue: "TENANT_FINANCE",
    reason: "FINANCIAL_SUBJECT",
    requiresHuman: true,
  },
  POSSIBLE_RISK: human("POSSIBLE_RISK"),
  UNKNOWN: human("MISSING_CONTEXT"),
};

/** Fila do assunto administrativo, pela intenção reconhecida. */
export const INTENT_ROUTING: Record<AdminIntent, RoutingDecision> = {
  SCHEDULING: { queue: "AGENDA", reason: "AGENDA_REQUEST", requiresHuman: false },
  RESCHEDULING: { queue: "AGENDA", reason: "AGENDA_REQUEST", requiresHuman: false },
  CONFIRMATION: { queue: "AGENDA", reason: "AGENDA_REQUEST", requiresHuman: false },
  CANCELLATION: { queue: "AGENDA", reason: "AGENDA_REQUEST", requiresHuman: false },
  PAYMENT: {
    queue: "TENANT_FINANCE",
    reason: "FINANCIAL_SUBJECT",
    requiresHuman: false,
  },
  PRICING: {
    queue: "COMMERCIAL",
    reason: "COMMERCIAL_QUESTION",
    requiresHuman: false,
  },
  SERVICES: {
    queue: "COMMERCIAL",
    reason: "COMMERCIAL_QUESTION",
    requiresHuman: false,
  },
  LOCATION: {
    queue: "ADMINISTRATIVE_SUPPORT",
    reason: "ADMINISTRATIVE_QUESTION",
    requiresHuman: false,
  },
  NONE: human("MISSING_CONTEXT"),
};

/**
 * O que a equipe pode fazer com um lead pelo painel. Espelhado em
 * `leadTeamTransitionOk()` nas rules. Reabrir um encerrado é assumi-lo de novo:
 * não existe volta silenciosa para a fila.
 */
export const LEAD_TEAM_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ["TAKEN_OVER", "CLOSED"],
  WAITING_TEAM: ["TAKEN_OVER", "CLOSED"],
  TAKEN_OVER: ["CLOSED"],
  CLOSED: ["TAKEN_OVER"],
};

/**
 * Consentimento para o WhatsApp dado pela própria pessoa, por mensagem.
 *
 * Uma primeira mensagem não é consentimento: só vale a manifestação que nomeia
 * o canal, escrita como está aqui. **Sem acento e em maiúsculas de propósito**
 * — a comparação é sobre o texto normalizado (`foldInbound`), e acentuar um
 * termo faria a autorização falhar em silêncio.
 *
 * Os termos pertencem a UMA versão do texto. O registro guarda a versão, e só
 * a vigente autoriza resposta a lead: trocar o texto do consentimento invalida
 * o que foi dado antes, até a pessoa autorizar de novo.
 *
 * RASCUNHO: redação e base legal dependem de revisão jurídica.
 */
export const LEAD_WHATSAPP_CONSENT = {
  textVersion: NOTIFICATION_CONSENT_TEXT_VERSION,
  acceptanceTerms: [
    "AUTORIZO MENSAGENS PELO WHATSAPP",
    "ACEITO RECEBER MENSAGENS PELO WHATSAPP",
  ],
  /** O que a equipe mostra à pessoa antes de ela autorizar. */
  invitation:
    "Para receber respostas da assistente virtual da organização por este WhatsApp, responda exatamente: AUTORIZO MENSAGENS PELO WHATSAPP. A autorização é opcional e pode ser retirada a qualquer momento enviando SAIR.",
} as const;

/** Texto registrado na trilha quando a pessoa autoriza pela própria conversa. */
export const LEAD_CONSENT_NOTE =
  "Consentimento para o WhatsApp dado pela própria pessoa, por mensagem, na versão vigente do texto.";

/** Texto registrado na trilha quando um contato desconhecido vira lead. */
export const LEAD_CREATED_NOTE =
  "Novo contato pelo WhatsApp registrado como lead, sem cadastro de cliente.";
