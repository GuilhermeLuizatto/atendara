import {
  APPOINTMENT_EVENT_META,
  CHANNEL_META,
  CONSENT_DISCLOSURE_PHRASES,
  NOTIFICATION_CONSENT_REVIEW_STATUS,
  NOTIFICATION_CONSENT_TEXT_VERSION,
} from "@/config/notifications";
import type {
  AppointmentDisclosureLevel,
  AppointmentNotificationEvent,
  OutboundChannel,
} from "@/types";

/**
 * Texto que a pessoa atendida le, ou ouve, antes de autorizar avisos.
 *
 * Montado a partir do que a profissao de fato permite — eventos, canais e grau
 * de exposicao — e nao escrito a mao: um texto fixo prometeria "so data e
 * horario" a quem recebe tambem o nome de quem atende.
 */

export interface ConsentStatementInput {
  organizationName: string;
  channels: readonly OutboundChannel[];
  events: readonly AppointmentNotificationEvent[];
  disclosure: AppointmentDisclosureLevel;
}

export interface ConsentStatement {
  version: string;
  reviewStatus: typeof NOTIFICATION_CONSENT_REVIEW_STATUS;
  paragraphs: string[];
}

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

export function consentStatement(input: ConsentStatementInput): ConsentStatement {
  const name = input.organizationName.trim();
  const subject = name || "Esta organizacao";
  const object = name || "esta organizacao";
  const channels = joinList(input.channels.map((channel) => CHANNEL_META[channel].label));
  const events = joinList(input.events.map((event) => APPOINTMENT_EVENT_META[event].consentLabel));
  const intermediaries = joinList([
    ...new Set(input.channels.map((channel) => CHANNEL_META[channel].consentIntermediary)),
  ]);

  return {
    version: NOTIFICATION_CONSENT_TEXT_VERSION,
    reviewStatus: NOTIFICATION_CONSENT_REVIEW_STATUS,
    paragraphs: [
      `${subject} pode enviar avisos sobre os seus horarios de atendimento (${events}) pelos canais que voce escolher entre: ${channels}.`,
      `Os avisos ${CONSENT_DISCLOSURE_PHRASES[input.disclosure]}. Nao informam o motivo do atendimento.`,
      `Para chegar ate voce, cada aviso passa ${intermediaries}.`,
      `Autorizar e opcional e nao muda o seu atendimento. Voce pode retirar a autorizacao quando quiser, de um canal ou de todos, pedindo a ${object}.`,
    ],
  };
}
