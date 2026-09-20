// Gerado por scripts/build-functions.mjs.
export const WHATSAPP_BUTTONS = ["CONFIRM", "RESCHEDULE"];
/** O que cada botão mostra escrito, em pt-BR. */
export const WHATSAPP_BUTTON_LABELS = {
    CONFIRM: "Confirmar",
    RESCHEDULE: "Remarcar",
};
const TIME_ONLY = ["clientName", "organizationName", "date", "time"];
const WITH_PROFESSIONAL = [
    "clientName",
    "organizationName",
    "professionalName",
    "date",
    "time",
];
const WITH_SERVICE = [
    "clientName",
    "organizationName",
    "professionalName",
    "serviceTerm",
    "date",
    "time",
];
/**
 * Evento × grau de exposição → modelo.
 *
 * Os eventos sem tarefa no servidor (`APPOINTMENT_SCHEDULED` e
 * `APPOINTMENT_CANCELLED`, hoje) ficam de fora: um modelo cadastrado para
 * evento que não executa prometeria envio que não existe.
 */
export const WHATSAPP_TEMPLATES = {
    APPOINTMENT_REMINDER: {
        TIME_ONLY: {
            name: "atendara_lembrete_horario",
            language: "pt_BR",
            parameters: TIME_ONLY,
            buttons: ["CONFIRM", "RESCHEDULE"],
        },
        TIME_AND_PROFESSIONAL: {
            name: "atendara_lembrete_profissional",
            language: "pt_BR",
            parameters: WITH_PROFESSIONAL,
            buttons: ["CONFIRM", "RESCHEDULE"],
        },
        TIME_PROFESSIONAL_AND_SERVICE: {
            name: "atendara_lembrete_servico",
            language: "pt_BR",
            parameters: WITH_SERVICE,
            buttons: ["CONFIRM", "RESCHEDULE"],
        },
    },
    APPOINTMENT_CONFIRMED: {
        TIME_ONLY: {
            name: "atendara_confirmacao_horario",
            language: "pt_BR",
            parameters: TIME_ONLY,
            buttons: [],
        },
        TIME_AND_PROFESSIONAL: {
            name: "atendara_confirmacao_profissional",
            language: "pt_BR",
            parameters: WITH_PROFESSIONAL,
            buttons: [],
        },
        TIME_PROFESSIONAL_AND_SERVICE: {
            name: "atendara_confirmacao_servico",
            language: "pt_BR",
            parameters: WITH_SERVICE,
            buttons: [],
        },
    },
};
export function whatsappTemplateFor(event, disclosure) {
    return WHATSAPP_TEMPLATES[event]?.[disclosure] ?? null;
}
