import type { AppointmentDisclosureLevel, AppointmentNotificationEvent } from "@/types";

import type { TemplateVariable } from "./notifications";

/**
 * Modelos aprovados do WhatsApp, como DADO (Fase 3, 13.4).
 *
 * A Meta não entrega texto livre fora da janela de 24 horas: entrega **modelo
 * aprovado**, identificado por nome e idioma, com os valores entrando em
 * posições numeradas. Este arquivo é a tradução entre o que o Atendara decide
 * (evento e grau de exposição) e o que a Meta reconhece.
 *
 * **Nenhuma profissão aparece aqui, e isso é a regra 1 do projeto.** A
 * profissão escolhe o grau de exposição em `definitions.ts`; o grau escolhe o
 * modelo. Uma profissão nova não acrescenta uma linha sequer neste arquivo.
 *
 * O texto aprovado na Meta **não vive aqui** — vive na conta da Meta. O que
 * vive aqui é o contrato: qual modelo, em que idioma, com quais variáveis e em
 * que ordem. Divergência entre os dois é erro de cadastro, e a 13.4 confere na
 * publicação do remetente.
 */

export interface WhatsappTemplate {
  /** Nome exato do modelo aprovado na Meta. Sem acento e em minúsculas. */
  name: string;
  /** Código de idioma da Meta. `pt_BR` para tudo o que sai para o Brasil. */
  language: string;
  /**
   * Variáveis do corpo, **na ordem em que a Meta as numera**. Trocar a ordem
   * aqui troca o que a pessoa lê — por isso a lista é conferida por teste
   * contra o grau de exposição.
   */
  parameters: readonly TemplateVariable[];
  /**
   * Botões de resposta rápida do modelo, na ordem. Vazio quando o modelo só
   * informa. O que cada botão faz é decidido na 13.5 (mensagem recebida) e na
   * 13.6 (remarcação) — aqui fica só o que a Meta precisa reconhecer.
   */
  buttons: readonly WhatsappTemplateButton[];
}

export const WHATSAPP_BUTTONS = ["CONFIRM", "RESCHEDULE"] as const;

export type WhatsappTemplateButton = (typeof WHATSAPP_BUTTONS)[number];

/** O que cada botão mostra escrito, em pt-BR. */
export const WHATSAPP_BUTTON_LABELS: Record<WhatsappTemplateButton, string> = {
  CONFIRM: "Confirmar",
  RESCHEDULE: "Remarcar",
};

const TIME_ONLY: readonly TemplateVariable[] = ["clientName", "organizationName", "date", "time"];
const WITH_PROFESSIONAL: readonly TemplateVariable[] = [
  "clientName",
  "organizationName",
  "professionalName",
  "date",
  "time",
];
const WITH_SERVICE: readonly TemplateVariable[] = [
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
export const WHATSAPP_TEMPLATES: Partial<
  Record<AppointmentNotificationEvent, Record<AppointmentDisclosureLevel, WhatsappTemplate>>
> = {
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

export function whatsappTemplateFor(
  event: AppointmentNotificationEvent,
  disclosure: AppointmentDisclosureLevel,
): WhatsappTemplate | null {
  return WHATSAPP_TEMPLATES[event]?.[disclosure] ?? null;
}
