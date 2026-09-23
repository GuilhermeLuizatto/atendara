import {
  CALENDAR_BUSY_STALE_MINUTES,
  CALENDAR_EVENT_DISCLOSURE,
  CALENDAR_PRIVATE_EVENT_TITLE,
  type CalendarSyncAction,
} from "@/config/calendar";
import type { Appointment, AppointmentDisclosureLevel, ISODateString } from "@/types";

import type { BusyBlock } from "./availability";

/**
 * Google Calendar (Fase 3, 13.7), sem I/O.
 *
 * Duas direções, e cada uma com uma regra que não se negocia:
 *
 * - **para fora**, o evento só pode dizer o que o grau de exposição da
 *   profissão permite. A agenda do Google não é um lugar mais privado do que o
 *   WhatsApp: ela toca no relógio, aparece na tela de bloqueio e sincroniza com
 *   aparelhos que o profissional nem lembra que existem;
 * - **para dentro**, só entra faixa de tempo. Título, convidado e descrição de
 *   evento externo **não são lidos, não são gravados e não passam por aqui** —
 *   o compromisso pessoal de quem atende não é assunto do Atendara.
 */

export interface CalendarEvent {
  summary: string;
  startsAt: ISODateString;
  endsAt: ISODateString;
  /** Nunca leva observação administrativa, valor nem qualquer nota clínica. */
  description: string | null;
}

/**
 * O que o evento diz, pelo grau de exposição da profissão.
 *
 * No grau mais fechado sobra "Atendimento" e o horário — de propósito: quem
 * olha o celular na mesa vê que há compromisso, e não quem é.
 */
export function calendarEventFor(input: {
  appointment: Pick<Appointment, "startsAt" | "endsAt" | "clientName">;
  serviceTerm: string;
  disclosure: AppointmentDisclosureLevel;
}): CalendarEvent {
  const policy = CALENDAR_EVENT_DISCLOSURE[input.disclosure];
  const partes: string[] = [];
  if (policy.includeServiceTerm) partes.push(input.serviceTerm);
  if (policy.includeClientName) partes.push(input.appointment.clientName);

  return {
    summary: partes.length > 0 ? partes.join(" — ") : CALENDAR_PRIVATE_EVENT_TITLE,
    startsAt: input.appointment.startsAt,
    endsAt: input.appointment.endsAt,
    // Descrição sempre vazia: é onde texto pessoal costuma vazar sem ninguém
    // perceber, e nada do que ela carregaria é necessário para a agenda.
    description: null,
  };
}

/**
 * O que fazer no Google depois de uma mudança no Atendara.
 *
 * A fonte da verdade é daqui: o Google recebe o reflexo. Atendimento cancelado
 * some da agenda; remarcado muda de horário; sem evento e ainda ativo, nasce.
 */
export function decideCalendarSync(input: {
  before: Pick<Appointment, "startsAt" | "endsAt" | "status" | "clientName"> | null;
  after: Pick<Appointment, "startsAt" | "endsAt" | "status" | "clientName"> | null;
  /** Id do evento já criado no Google, quando existe. */
  externalEventId: string | null;
}): CalendarSyncAction {
  const { before, after, externalEventId } = input;
  const encerrado = (status: string | undefined) => status === "CANCELLED" || status === "NO_SHOW";

  if (!after || encerrado(after.status)) return externalEventId ? "DELETE" : "NONE";
  if (!externalEventId) return "CREATE";

  const mudou =
    !before ||
    before.startsAt !== after.startsAt ||
    before.endsAt !== after.endsAt ||
    before.clientName !== after.clientName ||
    encerrado(before.status) !== encerrado(after.status);
  return mudou ? "UPDATE" : "NONE";
}

/**
 * Lê a resposta de livre/ocupado do Google e devolve **só faixas de tempo**.
 *
 * Qualquer outro campo é descartado aqui, e não lá na frente: o que não é lido
 * não tem como ser gravado por engano.
 */
export function parseBusyBlocks(data: unknown): BusyBlock[] {
  if (typeof data !== "object" || data === null) return [];
  const calendars = (data as { calendars?: unknown }).calendars;
  if (typeof calendars !== "object" || calendars === null) return [];

  const blocks: BusyBlock[] = [];
  for (const calendar of Object.values(calendars as Record<string, unknown>)) {
    const busy = (calendar as { busy?: unknown })?.busy;
    if (!Array.isArray(busy)) continue;
    for (const entry of busy) {
      const start = (entry as { start?: unknown })?.start;
      const end = (entry as { end?: unknown })?.end;
      if (typeof start !== "string" || typeof end !== "string") continue;
      const startMs = Date.parse(start);
      const endMs = Date.parse(end);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
      blocks.push({ startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString() });
    }
  }
  return blocks.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/**
 * O ocupado lido ainda serve?
 *
 * Entre uma leitura e outra, um compromisso novo no Google não existe para o
 * Atendara. Velho demais, o bloco deixa de valer como prova de vaga — e a
 * oferta de horários prefere escalar a oferecer um horário que já foi tomado.
 */
export function isBusySnapshotFresh(readAt: ISODateString | null, now: ISODateString): boolean {
  if (!readAt) return false;
  const age = Date.parse(now) - Date.parse(readAt);
  return age >= 0 && age <= CALENDAR_BUSY_STALE_MINUTES * 60_000;
}

/** Erro parcial do Google não é prova de agenda livre. */
export function parsePrimaryBusy(data: unknown): BusyBlock[] | null {
  if (!data || typeof data !== "object") return null;
  const calendars = (data as { calendars?: Record<string, unknown> }).calendars;
  const primary = calendars?.primary as { errors?: unknown; busy?: unknown } | undefined;
  if (!primary || (primary.errors !== undefined && (!Array.isArray(primary.errors) || primary.errors.length > 0))) return null;
  if (!Array.isArray(primary.busy)) return null;
  const blocks = parseBusyBlocks({ calendars: { primary } });
  return blocks.length === primary.busy.length ? blocks : null;
}
