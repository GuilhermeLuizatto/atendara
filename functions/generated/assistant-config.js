// Gerado por scripts/build-functions.mjs.
/**
 * O que a assistente diz na conversa, como DADO.
 *
 * **Nenhuma profissão aqui** (regra 1): as respostas falam de horário e da
 * organização, nunca do motivo do atendimento, então servem a qualquer grau de
 * exposição. Mesmo assim o texto passa pela barreira de conteúdo dos avisos
 * (`FORBIDDEN_TEMPLATE_TERMS`) em `lib/notifications/replies.ts`.
 *
 * Decisões do titular em 24/09 (`docs/planos/DARA-RESPOSTA-REMARCACAO-2026-09-24.md`):
 * a assistente se apresenta como assistente virtual na primeira mensagem, a
 * oferta é texto numerado e o encaminhamento à equipe não diz o motivo.
 */
/** Nome com que a assistente se apresenta. */
export const ASSISTANT_NAME = "Dara";
/**
 * Teto de uma resposta. Maior que o do modelo aprovado do WhatsApp
 * (`CHANNEL_META.WHATSAPP.maxBodyLength`), que pensa na tela bloqueada: uma
 * oferta com cinco horarios, um por linha, nao cabe nele. A Meta aceita bem
 * mais que isso em texto livre dentro da janela.
 */
export const REPLY_MAX_BODY_LENGTH = 1_000;
/**
 * Variáveis de uma resposta. Lista fechada, como a dos avisos: o renderizador
 * recusa qualquer outra.
 */
export const REPLY_VARIABLES = [
    "clientName",
    "organizationName",
    "assistantName",
    "date",
    "time",
    "slotOptions",
    "holdMinutes",
    "responseText",
];
/*
 * O encaminhamento muda de texto conforme o ponto do pedido (`ReplyStage`):
 * antes da oferta a assistente ainda não se apresentou; depois de uma escolha
 * que não vingou, a pessoa já sabe com quem fala e precisa saber que o horário
 * caiu.
 */
/** Apresentação, só na primeira mensagem da assistente num pedido. */
export const REPLY_INTRODUCTION = "Olá, {{clientName}}! Aqui é a {{assistantName}}, assistente virtual de {{organizationName}}.";
/**
 * A mesma apresentação para quem não tem cadastro (lead): não há nome a usar,
 * e inventar um seria pior do que não cumprimentar pelo nome.
 */
export const REPLY_INTRODUCTION_WITHOUT_NAME = "Olá! Aqui é a {{assistantName}}, assistente virtual de {{organizationName}}.";
const INTRODUCTION = REPLY_INTRODUCTION;
/**
 * Parágrafos de cada resposta, na ordem. `{{slotOptions}}` ocupa um parágrafo
 * inteiro: é a lista numerada, uma opção por linha.
 */
export const CONVERSATION_REPLY_TEXTS = {
    ADMINISTRATIVE_REPLY: {
        REQUEST: [INTRODUCTION, "{{responseText}}"],
        CHOICE: [],
    },
    RESCHEDULE_OFFERED: {
        REQUEST: [
            `${INTRODUCTION} Estes horários estão livres para o seu atendimento:`,
            "{{slotOptions}}",
            "Responda com o número da opção nos próximos {{holdMinutes}} minutos. Se nenhum servir, é só dizer, que a equipe fala com você.",
        ],
        // Não há oferta depois de uma escolha: horário que caiu vai para a equipe.
        CHOICE: [],
    },
    RESCHEDULE_CONFIRMED: {
        REQUEST: [],
        CHOICE: ["Pronto! Seu atendimento ficou para {{date}}, às {{time}}."],
    },
    RESCHEDULE_HANDED_OFF: {
        REQUEST: [
            INTRODUCTION,
            "Recebemos seu pedido para remarcar. A equipe vai falar com você por aqui.",
        ],
        CHOICE: [
            "Esse horário acabou de ficar indisponível. A equipe vai falar com você por aqui para combinar outro.",
        ],
    },
    SCHEDULE_OFFERED: {
        REQUEST: [
            `${INTRODUCTION} Estes horários estão livres para um novo atendimento:`,
            "{{slotOptions}}",
            "Responda com o número da opção nos próximos {{holdMinutes}} minutos.",
        ],
        CHOICE: [],
    },
    SCHEDULE_CONFIRMED: {
        REQUEST: [],
        CHOICE: [
            "Pronto! Seu atendimento foi agendado para {{date}}, às {{time}}.",
        ],
    },
    SCHEDULE_HANDED_OFF: {
        REQUEST: [
            INTRODUCTION,
            "Recebemos seu pedido para agendar. A equipe vai falar com você por aqui.",
        ],
        CHOICE: [
            "Esse horário acabou de ficar indisponível. A equipe vai falar com você por aqui para combinar outro.",
        ],
    },
    CANCELLATION_CONFIRMED: {
        REQUEST: [
            `${INTRODUCTION} Seu atendimento de {{date}}, às {{time}}, foi cancelado.`,
        ],
        CHOICE: [],
    },
    CANCELLATION_HANDED_OFF: {
        REQUEST: [
            INTRODUCTION,
            "Recebemos seu pedido de cancelamento. A equipe vai falar com você por aqui.",
        ],
        CHOICE: [],
    },
};
