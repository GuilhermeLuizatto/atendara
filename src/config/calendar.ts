import type { AppointmentDisclosureLevel } from "@/types";

/**
 * Integração com o Google Calendar (Fase 3, 13.7), como DADO.
 *
 * **O Atendara é a fonte da verdade.** O Google recebe uma cópia do que já foi
 * decidido aqui, e devolve **apenas** blocos de ocupado. Nada que vem de lá
 * vira atendimento, cadastro ou texto: um evento externo é uma faixa de tempo
 * indisponível, e mais nada.
 */

/**
 * Livre/ocupado da agenda principal e, para escrever, só a agenda que o próprio
 * Atendara cria (`app.created`): o Atendara nunca enxerga nem altera outro
 * evento do profissional.
 */
export const GOOGLE_CALENDAR_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
export const GOOGLE_CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

export const GOOGLE_CALENDAR_SCOPES = [GOOGLE_CALENDAR_FREEBUSY_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE] as const;

export const GOOGLE_CALENDAR_NAME = "Atendara";

/**
 * O que o evento no Google pode dizer, por grau de exposição da profissão.
 *
 * É o mesmo grau que limita o aviso ao cliente, pelo mesmo motivo: a agenda do
 * Google não é um lugar mais privado do que o WhatsApp — ela sincroniza com
 * celular, relógio e notificação na tela de bloqueio.
 *
 * **No grau mais fechado, o evento não tem nome de pessoa nem tipo de
 * atendimento.** Sobra a faixa de horário ocupada, que é o que a agenda precisa.
 */
export const CALENDAR_EVENT_DISCLOSURE: Record<
  AppointmentDisclosureLevel,
  { includeClientName: boolean; includeServiceTerm: boolean }
> = {
  TIME_ONLY: { includeClientName: false, includeServiceTerm: false },
  TIME_AND_PROFESSIONAL: { includeClientName: true, includeServiceTerm: false },
  TIME_PROFESSIONAL_AND_SERVICE: { includeClientName: true, includeServiceTerm: true },
};

/** Título do evento quando o grau não deixa dizer quem nem o quê. */
export const CALENDAR_PRIVATE_EVENT_TITLE = "Atendimento";

/** Janela de ocupado lida do Google a cada sincronização. */
export const CALENDAR_BUSY_WINDOW_DAYS = 30;

/**
 * Intervalo reservado para a futura atualização automática (a atual é manual).
 *
 * O bloco lido fica velho entre uma leitura e outra — um compromisso marcado no
 * Google agora só aparece na próxima. Por isso a oferta de horários da 13.6
 * guarda o instante da leitura: horário oferecido com dado velho é o preço
 * desse desenho, e ele está escrito.
 */
export const CALENDAR_REFRESH_MINUTES = 30;

/** Depois disso, o ocupado lido é velho demais para segurar uma oferta. */
export const CALENDAR_BUSY_STALE_MINUTES = 120;

/**
 * Folga para leitura "à frente" do relógio de quem confere: o painel avança o
 * relógio a cada minuto e o navegador pode estar um pouco atrás do servidor.
 * Sem ela, a leitura recém-feita aparece como desatualizada.
 */
export const CALENDAR_CLOCK_SKEW_MINUTES = 5;

export const CALENDAR_CONNECTION_STATUSES = ["CONNECTED", "REVOKED", "ERROR"] as const;

export type CalendarConnectionStatus = (typeof CALENDAR_CONNECTION_STATUSES)[number];

export const CALENDAR_SYNC_ACTIONS = ["CREATE", "UPDATE", "DELETE", "NONE"] as const;

export type CalendarSyncAction = (typeof CALENDAR_SYNC_ACTIONS)[number];
