// Gerado por scripts/build-functions.mjs.
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "./app-config.js";
/**
 * Formatadores.
 *
 * O fuso e sempre explicito. Sem isso, o mesmo timestamp renderiza diferente no
 * servidor (UTC) e no navegador do usuario, o que quebra a hidratacao do React
 * com um erro dificil de rastrear.
 */
const currencyFormatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency: "BRL",
});
const compactCurrencyFormatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
});
export function formatCurrency(amountInCents) {
    return currencyFormatter.format(amountInCents / 100);
}
export function formatCurrencyCompact(amountInCents) {
    return compactCurrencyFormatter.format(amountInCents / 100);
}
const timeFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DEFAULT_TIMEZONE,
});
const dateFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: DEFAULT_TIMEZONE,
});
const shortDateFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    day: "2-digit",
    month: "short",
    timeZone: DEFAULT_TIMEZONE,
});
const weekdayFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: DEFAULT_TIMEZONE,
});
export function formatTime(iso) {
    return timeFormatter.format(new Date(iso));
}
export function formatDate(iso) {
    return dateFormatter.format(new Date(iso));
}
export function formatShortDate(iso) {
    return shortDateFormatter.format(new Date(iso));
}
export function formatDateTime(iso) {
    return `${formatDate(iso)} às ${formatTime(iso)}`;
}
export function formatWeekday(iso) {
    return weekdayFormatter.format(new Date(iso));
}
/** "agora", "ha 5 min", "ha 2 h", "ha 3 d" — para listas de mensagens. */
export function formatRelativeToNow(iso, now = new Date()) {
    const diffMs = now.getTime() - new Date(iso).getTime();
    const diffMinutes = Math.round(diffMs / 60_000);
    if (diffMinutes < 1)
        return "agora";
    if (diffMinutes < 60)
        return `há ${diffMinutes} min`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24)
        return `há ${diffHours} h`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 30)
        return `há ${diffDays} d`;
    return formatShortDate(iso);
}
/** "em 25 min", "em 3 h", "amanha", "sexta-feira" — para eventos futuros. */
export function formatTimeUntil(iso, now = new Date()) {
    const diffMinutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
    if (diffMinutes <= 0)
        return "agora";
    if (diffMinutes < 60)
        return `em ${diffMinutes} min`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 12)
        return `em ${diffHours} h`;
    const daysApart = calendarDaysApart(now, new Date(iso));
    if (daysApart === 0)
        return `hoje às ${formatTime(iso)}`;
    if (daysApart === 1)
        return `amanhã às ${formatTime(iso)}`;
    if (daysApart < 7)
        return weekdayOnlyFormatter.format(new Date(iso));
    return formatShortDate(iso);
}
const weekdayOnlyFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    weekday: "long",
    timeZone: DEFAULT_TIMEZONE,
});
const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: DEFAULT_TIMEZONE,
});
/** Diferenca em dias de CALENDARIO no fuso do produto, nao em horas corridas. */
function calendarDaysApart(from, to) {
    const fromKey = dateKeyFormatter.format(from);
    const toKey = dateKeyFormatter.format(to);
    const fromUtc = Date.parse(`${fromKey}T12:00:00.000Z`);
    const toUtc = Date.parse(`${toKey}T12:00:00.000Z`);
    return Math.round((toUtc - fromUtc) / 86_400_000);
}
const hourFormatter = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hour12: false,
    timeZone: DEFAULT_TIMEZONE,
});
/** Hora do dia no fuso do produto, para saudacoes e faixas de horario. */
export function productHour(date) {
    return Number(hourFormatter.format(date));
}
/** Formata telefone brasileiro; devolve a entrada intacta se nao reconhecer. */
export function formatPhone(phone) {
    if (!phone)
        return "";
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 11) {
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
        return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    return phone;
}
export function formatPercent(ratio) {
    return `${Math.round(ratio * 100)}%`;
}
/** Iniciais para avatares: "Maria Silva Santos" -> "MS". */
export function initials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0)
        return "?";
    if (parts.length === 1)
        return parts[0].slice(0, 2).toLocaleUpperCase("pt-BR");
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toLocaleUpperCase("pt-BR");
}
export function truncate(text, maxLength) {
    if (text.length <= maxLength)
        return text;
    return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}
