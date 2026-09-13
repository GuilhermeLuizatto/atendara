// Gerado por scripts/build-functions.mjs.
export const CHANNEL_META = {
    EMAIL: {
        label: "E-mail",
        contactField: "email",
        providerId: "SIMULATED",
        maxBodyLength: 600,
        activationRequirement: "Domínio remetente verificado no provedor de e-mail e registro de retorno configurado.",
        consentIntermediary: "pelo provedor de e-mail usado pela organização",
    },
    SMS: {
        label: "SMS",
        contactField: "phone",
        providerId: "SIMULATED",
        maxBodyLength: 160,
        activationRequirement: "Número remetente habilitado na operadora e telefone do destinatário em formato internacional.",
        consentIntermediary: "pela operadora de telefonia",
    },
    WHATSAPP: {
        label: "WhatsApp",
        contactField: "phone",
        providerId: "SIMULATED",
        maxBodyLength: 400,
        activationRequirement: "Número aprovado na API oficial do WhatsApp Business e modelo de mensagem homologado pela Meta.",
        consentIntermediary: "pelo WhatsApp, serviço da Meta",
    },
};
export const APPOINTMENT_EVENT_META = {
    APPOINTMENT_SCHEDULED: {
        label: "Agendamento registrado",
        description: "Avisa quando um novo horário é marcado.",
        defaultEnabled: false,
        allowedLeadMinutes: [0],
        anchor: "CHANGE",
        consentLabel: "horário marcado",
    },
    APPOINTMENT_REMINDER: {
        label: "Lembrete",
        description: "Avisa antes do horário marcado.",
        defaultEnabled: false,
        allowedLeadMinutes: [60, 180, 720, 1_440, 2_880],
        anchor: "START",
        consentLabel: "lembrete antes do horário",
    },
    APPOINTMENT_CONFIRMED: {
        label: "Confirmação registrada",
        description: "Avisa que o horário foi confirmado. Confirmar na agenda NÃO envia nada por si só: sem esta regra habilitada, a confirmação apenas muda o atendimento.",
        defaultEnabled: false,
        allowedLeadMinutes: [0],
        anchor: "CHANGE",
        consentLabel: "confirmação do horário",
    },
    APPOINTMENT_CANCELLED: {
        label: "Cancelamento",
        description: "Avisa que o horário foi cancelado.",
        defaultEnabled: false,
        allowedLeadMinutes: [0],
        anchor: "CHANGE",
        consentLabel: "cancelamento do horário",
    },
};
// ------------------------------------------------------- consentimento
/**
 * Versao do texto de consentimento. Vai gravada em
 * `NotificationConsent.textVersion`: trocar o texto exige trocar a versao, ou
 * deixa de ser possivel saber o que cada pessoa aceitou.
 *
 * RASCUNHO: redacao, base legal e necessidade do consentimento para cada
 * evento dependem de revisao por profissional qualificado.
 */
export const NOTIFICATION_CONSENT_TEXT_VERSION = "2026-09-11-rascunho";
export const NOTIFICATION_CONSENT_REVIEW_STATUS = "DRAFT_PENDING_LEGAL_REVIEW";
/**
 * O que o aviso mostra, dito a pessoa. Precisa acompanhar
 * `ALLOWED_BY_DISCLOSURE` em `lib/notifications/templates.ts`: prometer menos
 * do que o renderizador interpola seria consentimento para outra coisa.
 */
export const CONSENT_DISCLOSURE_PHRASES = {
    TIME_ONLY: "trazem apenas o seu nome, o nome da organização, a data e o horário",
    TIME_AND_PROFESSIONAL: "trazem o seu nome, o nome da organização, o nome de quem atende, a data e o horário",
    TIME_PROFESSIONAL_AND_SERVICE: "trazem o seu nome, o nome da organização, o nome de quem atende, o tipo de atendimento, a data e o horário",
};
/** Orientacao para a equipe, fora do texto que a pessoa le. */
export const CONSENT_STAFF_INSTRUCTION = "Leia ou mostre o texto acima à pessoa. Marque somente se ela autorizou, e só os canais que ela escolheu.";
export const CONSENT_MEDIUM_LABELS = {
    FORM: "Formulário",
    WRITTEN_DOCUMENT: "Documento escrito",
    MESSAGE: "Mensagem",
};
/** Exemplo de cada meio, para a equipe escolher sem adivinhar. */
export const CONSENT_MEDIUM_HINTS = {
    FORM: "a pessoa respondeu na hora e a equipe marcou neste cadastro",
    WRITTEN_DOCUMENT: "termo ou ficha assinada pela pessoa",
    MESSAGE: "e-mail, WhatsApp ou SMS enviado pela pessoa",
};
export const CONSENT_RECORDER_LABELS = {
    STAFF: "registrado pela equipe",
    SUBJECT: "registrado pela própria pessoa",
};
export const LEGAL_GUARDIAN_RELATIONSHIP_LABELS = {
    PARENT: "Mãe ou pai",
    LEGAL_GUARDIAN: "Tutor ou outro responsável legal",
};
/** Nome do responsavel legal: o mesmo minimo do nome do cadastro. */
export const LEGAL_GUARDIAN_NAME_MIN_LENGTH = 3;
// ------------------------------------------------------------- modelos
/**
 * Variaveis aceitas em um modelo.
 *
 * A lista e fechada: o renderizador recusa qualquer outra. Nao e conveniencia —
 * e o que impede alguem de escrever uma observacao interna do cadastro dentro
 * de um lembrete e manda-la para o celular de quem e atendido.
 */
export const TEMPLATE_VARIABLES = [
    "clientName",
    "organizationName",
    "professionalName",
    "serviceTerm",
    "date",
    "time",
];
/**
 * Vocabulario que nao pode aparecer no texto que sai.
 *
 * Um lembrete precisa de horario, nao de motivo. Qualquer uma destas palavras
 * transforma a mensagem em informacao de saude circulando por canal aberto e
 * visivel na tela bloqueada do celular. A verificacao e por radical e sem
 * acento, porque o texto do modelo e escrito por pessoas.
 */
export const FORBIDDEN_TEMPLATE_TERMS = [
    "diagnostic",
    "sintoma",
    "medicament",
    "remedi",
    "receita",
    "exame",
    "laudo",
    "prontuario",
    "tratamento",
    "terapia",
    "medicacao",
    "dose",
    "doenc",
    "transtorno",
    "lesao",
];
// ------------------------------------------------------------ tentativas
/**
 * Tentativas controladas.
 *
 * Tres tentativas com espera crescente. Falha temporaria (provedor fora do ar,
 * limite de taxa) merece nova tentativa; destino invalido e recusa do remetente
 * nao merecem nenhuma — repetir nao muda o resultado e so multiplica registro.
 */
export const RETRY_POLICY = {
    maxAttempts: 3,
    /** Espera, em minutos, antes da tentativa seguinte. */
    backoffMinutes: [5, 30],
    retriableFailures: ["PROVIDER_UNAVAILABLE", "RATE_LIMITED"],
};
export function isRetriable(code) {
    return RETRY_POLICY.retriableFailures.includes(code);
}
/**
 * Janela em que um envio atrasado ainda faz sentido.
 *
 * Lembrete que chega depois do horario nao e lembrete: e confusao. Passada a
 * janela, a entrega e cancelada em vez de tentada.
 */
export const MAX_DELIVERY_DELAY_MINUTES = 120;
// -------------------------------------------------------------- padroes
/**
 * O estado inicial de toda organizacao: nada ligado, nenhum remetente
 * comprovado, nenhuma regra. E a resposta a "o que acontece se ninguem
 * configurar?" — nada sai.
 */
export const DEFAULT_NOTIFICATION_SETTINGS = {
    enabled: false,
    verifiedSenderChannels: [],
    rules: [],
};
// --------------------------------------------------------------- rotulos
export const SKIP_REASON_LABELS = {
    ORGANIZATION_DISABLED: "A organização não ativou o envio de avisos.",
    SENDER_NOT_VERIFIED: "O canal não tem remetente comprovado.",
    NO_RULE_FOR_EVENT: "Nenhuma regra cobre este evento.",
    RULE_DISABLED: "A regra existe, mas está desativada.",
    EVENT_NOT_ALLOWED_FOR_PROFESSION: "A profissão não permite aviso para este evento.",
    CHANNEL_NOT_ALLOWED_FOR_PROFESSION: "A profissão não permite este canal pelo grau de sensibilidade dos dados.",
    EVENT_WITHOUT_AUTOMATION: "O servidor ainda não executa avisos deste evento; nenhuma mensagem sai por ele.",
    MISSING_CONTACT: "O cadastro não tem contato para este canal.",
    INVALID_CONTACT: "O contato do cadastro não passa na validação do canal.",
    MISSING_CONSENT: "O cadastro não registrou consentimento.",
    CONSENT_REVOKED: "O consentimento deste canal foi retirado.",
    CHANNEL_NOT_CONSENTED: "Não há consentimento registrado para este canal.",
    CONSENT_INCOMPLETE: "O registro do consentimento deste canal está incompleto: faltam data, versão do texto, quem registrou, meio ou responsável legal.",
    SCHEDULE_IN_THE_PAST: "O horário de envio já passou.",
    ALREADY_PLANNED: "Já existe um envio planejado igual a este.",
    TEMPLATE_REJECTED: "O modelo foi recusado pela política de conteúdo.",
};
export const DELIVERY_FAILURE_LABELS = {
    PROVIDER_UNAVAILABLE: "Provedor indisponível",
    INVALID_DESTINATION: "Destino inválido",
    RATE_LIMITED: "Limite de envio atingido",
    SENDER_NOT_ALLOWED: "Remetente não autorizado",
    ATTEMPTS_EXHAUSTED: "Tentativas esgotadas",
    DISPATCH_INTERRUPTED: "Envio interrompido sem confirmação",
};
export const NOTIFICATION_DISPATCH_STOP_LABELS = {
    RULE_NOT_FOUND: "A regra que planejou o aviso não existe mais.",
    APPOINTMENT_NOT_FOUND: "O atendimento não foi encontrado.",
    APPOINTMENT_CANCELLED: "O atendimento foi cancelado ou marcado como falta.",
    APPOINTMENT_RESCHEDULED: "O atendimento foi remarcado.",
    APPOINTMENT_CLIENT_CHANGED: "O atendimento passou para outro cadastro.",
    CLIENT_NOT_FOUND: "O cadastro de quem recebe o aviso não foi encontrado.",
    BODY_CHANGED: "O texto mudou entre o planejamento e o envio.",
};
export const PLATFORM_NOTICE_LABELS = {
    TRIAL_ENDING: "Período de teste terminando",
    PAYMENT_PENDING: "Pagamento pendente",
    ACCESS_ENDING: "Acesso vencendo",
    SUBSCRIPTION_CANCELED: "Assinatura cancelada",
    NO_SUBSCRIPTION: "Sem assinatura ativa",
};
/**
 * Antecedencia, em dias, em que a plataforma passa a avisar o assinante.
 * Sao avisos DA OPERADORA: nao usam canal de clinica e nao viram
 * `NotificationDelivery`.
 */
export const PLATFORM_NOTICE_WINDOW_DAYS = {
    trialEnding: 3,
    accessEnding: 5,
};
