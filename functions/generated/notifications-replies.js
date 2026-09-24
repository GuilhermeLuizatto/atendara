// Gerado por scripts/build-functions.mjs.
import { ASSISTANT_NAME, CONVERSATION_REPLY_TEXTS, REPLY_MAX_BODY_LENGTH, REPLY_VARIABLES, } from "./assistant-config.js";
import { RESCHEDULE_HOLD_MINUTES } from "./reschedule-config.js";
import { formatTime, formatWeekday } from "./format.js";
import { err, ok } from "./types.js";
import { hasForbiddenTerm } from "./notifications-templates.js";
const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;
/** "quarta-feira, 30 de setembro, às 08:00" — sem ano: a oferta é de dias próximos. */
function when(startsAt) {
    return `${formatWeekday(startsAt)}, às ${formatTime(startsAt)}`;
}
function valuesFor(context) {
    const slots = context.slots ?? [];
    return {
        clientName: context.clientName.trim() || null,
        organizationName: context.organizationName.trim() || null,
        assistantName: ASSISTANT_NAME,
        date: context.startsAt ? formatWeekday(context.startsAt) : null,
        time: context.startsAt ? formatTime(context.startsAt) : null,
        slotOptions: slots.length
            ? slots.map((slot, index) => `${index + 1}. ${when(slot.startsAt)}`).join("\n")
            : null,
        holdMinutes: String(RESCHEDULE_HOLD_MINUTES),
    };
}
export function renderReply(event, stage, context) {
    const paragraphs = CONVERSATION_REPLY_TEXTS[event][stage];
    if (paragraphs.length === 0)
        return err("EMPTY");
    if (paragraphs.some(hasForbiddenTerm))
        return err("FORBIDDEN_TERM");
    const known = new Set(REPLY_VARIABLES);
    const values = valuesFor(context);
    let rejection = null;
    const body = paragraphs
        .map((paragraph) => paragraph
        .replace(PLACEHOLDER, (match, name) => {
        if (!known.has(name)) {
            rejection ??= "UNKNOWN_VARIABLE";
            return match;
        }
        const value = values[name];
        // Valor ausente é resposta pela metade ("ficou para , às"): não sai.
        if (value === null) {
            rejection ??= "EMPTY";
            return match;
        }
        return value;
    })
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .join("\n"))
        .join("\n\n")
        .trim();
    if (rejection)
        return err(rejection);
    if (!body)
        return err("EMPTY");
    if (hasForbiddenTerm(body))
        return err("FORBIDDEN_TERM");
    if (body.length > REPLY_MAX_BODY_LENGTH)
        return err("TOO_LONG");
    return ok(body);
}
