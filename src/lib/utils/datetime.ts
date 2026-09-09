import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/config/app";
import type { ISODateString } from "@/types";

/**
 * Aritmetica de datas no fuso do produto.
 *
 * A agenda raciocina em DIAS DE CALENDARIO ("terca dia 9"), nao em instantes.
 * Misturar as duas coisas produz o bug classico do atendimento das 23h que
 * aparece no dia seguinte. Aqui a unidade e a `DateKey` — "2026-09-09" no fuso
 * de Sao Paulo — e a conversao para instante e explicita.
 *
 * Sao Paulo nao adota horario de verao desde 2019, entao o offset fixo -03:00 e
 * correto e dispensa uma biblioteca de fusos.
 */

const OFFSET = "-03:00";

/** Data-calendario no fuso do produto: "2026-09-09". */
export type DateKey = string;

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEFAULT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function toDateKey(date: Date): DateKey {
  return dateKeyFormatter.format(date);
}

/** "HH:mm" no fuso do produto, pronto para `<input type="time">`. */
export function toTimeValue(iso: ISODateString): string {
  return timeFormatter.format(new Date(iso));
}

export function shiftDays(key: DateKey, days: number): DateKey {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Instante absoluto do horario local informado, em ISO/UTC. */
export function atTime(key: DateKey, hour: number, minute = 0): ISODateString {
  return new Date(
    `${key}T${pad(hour)}:${pad(minute)}:00.000${OFFSET}`,
  ).toISOString();
}

/** Combina "2026-09-09" + "14:30" no instante correspondente. */
export function fromDateAndTime(key: DateKey, time: string): ISODateString {
  const [hour, minute] = time.split(":").map(Number);
  return atTime(key, hour || 0, minute || 0);
}

export function addMinutesISO(
  iso: ISODateString,
  minutes: number,
): ISODateString {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** Minutos desde a meia-noite local. Base do posicionamento na grade do dia. */
export function minutesIntoDay(iso: ISODateString): number {
  const [hour, minute] = toTimeValue(iso).split(":").map(Number);
  return hour * 60 + minute;
}

/** Dia da semana no fuso do produto. 0 = domingo. */
export function weekdayOf(key: DateKey): number {
  return new Date(`${key}T12:00:00.000Z`).getUTCDay();
}

export function isWeekend(key: DateKey): boolean {
  const day = weekdayOf(key);
  return day === 0 || day === 6;
}

/** Domingo da semana que contem a data. */
export function startOfWeek(key: DateKey): DateKey {
  return shiftDays(key, -weekdayOf(key));
}

export function weekKeys(key: DateKey): DateKey[] {
  const start = startOfWeek(key);
  return Array.from({ length: 7 }, (_, index) => shiftDays(start, index));
}

/**
 * Grade do mes: sempre 6 semanas completas. Altura fixa evita que o calendario
 * pule de tamanho ao navegar entre meses.
 */
export function monthGridKeys(key: DateKey): DateKey[] {
  const first = `${key.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => shiftDays(start, index));
}

export function isSameMonth(a: DateKey, b: DateKey): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

// ------------------------------------------------------------- rotulos

const monthLabelFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const dayLabelFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const shortWeekdayFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  weekday: "short",
  timeZone: "UTC",
});

/** Formata a partir da DateKey, sem passar por instante — evita erro de fuso. */
function keyAsUtcDate(key: DateKey): Date {
  return new Date(`${key}T12:00:00.000Z`);
}

export function monthLabel(key: DateKey): string {
  return monthLabelFormatter.format(keyAsUtcDate(key));
}

export function dayLabel(key: DateKey): string {
  return dayLabelFormatter.format(keyAsUtcDate(key));
}

export function shortWeekdayLabel(key: DateKey): string {
  return shortWeekdayFormatter.format(keyAsUtcDate(key)).replace(".", "");
}

export function dayOfMonth(key: DateKey): number {
  return Number(key.slice(8, 10));
}

export function weekLabel(keys: DateKey[]): string {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (isSameMonth(first, last)) {
    return `${dayOfMonth(first)} a ${dayOfMonth(last)} de ${monthLabel(first)}`;
  }
  return `${dayOfMonth(first)} de ${monthLabel(first)} a ${dayOfMonth(last)} de ${monthLabel(last)}`;
}
