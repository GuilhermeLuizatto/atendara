import { whatsappTemplateFor, type WhatsappTemplateButton } from "@/config/whatsapp";
import type { AppointmentDisclosureLevel, AppointmentNotificationEvent, OutboundChannel } from "@/types";

import type { TemplateContext } from "./templates";

/**
 * O que o WhatsApp precisa receber (Fase 3, 13.4).
 *
 * Fora da janela de 24 horas a Meta não entrega texto: entrega **modelo
 * aprovado** mais os valores, numerados na ordem em que o modelo os espera.
 * Esta função traduz o que o Atendara já decidiu — evento e grau de exposição —
 * no que a Meta reconhece, e é o único lugar onde essa tradução acontece.
 *
 * O **corpo continua sendo montado** pelo portão, e continua sendo dele o
 * `bodyHash` que impede enviar texto que ninguém revisou. O modelo não
 * substitui essa conferência: ele viaja ao lado dela.
 */
export interface WhatsappMessage {
  name: string;
  language: string;
  /** Valores do corpo, na ordem numerada da Meta. */
  parameters: string[];
  buttons: readonly WhatsappTemplateButton[];
}

export function whatsappMessageFor(input: {
  channel: OutboundChannel;
  event: AppointmentNotificationEvent;
  disclosure: AppointmentDisclosureLevel;
  context: TemplateContext;
}): WhatsappMessage | null {
  if (input.channel !== "WHATSAPP") return null;

  const template = whatsappTemplateFor(input.event, input.disclosure);
  if (!template) return null;

  return {
    name: template.name,
    language: template.language,
    // O grau de exposição já escolheu o modelo, e o modelo já escolheu as
    // variáveis: nenhum valor além dos que aquele grau autoriza chega aqui.
    parameters: template.parameters.map((variable) => input.context[variable]),
    buttons: template.buttons,
  };
}
