// Gerado por scripts/build-functions.mjs.
import { ASSISTANT_REPLY_DELAY_MINUTES } from "./automation-config.js";
import { addMinutes } from "./notifications-schedule.js";
function minutesOf(value) {
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}
function withinWindow(value, start, end) {
    const startMinutes = minutesOf(start);
    const endMinutes = minutesOf(end);
    return startMinutes <= endMinutes
        ? value >= startMinutes && value < endMinutes
        : value >= startMinutes || value < endMinutes;
}
function localClock(now, timezone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        weekday: "short",
    }).formatToParts(new Date(now));
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((part) => part.type === "weekday")?.value ?? "");
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return { day, minutes: hour * 60 + minute };
}
export function isWithinBusinessHours(organization, now) {
    const local = localClock(now, organization.timezone);
    return (organization.settings.agenda.workingDays.includes(local.day) &&
        withinWindow(local.minutes, organization.settings.agenda.workdayStart, organization.settings.agenda.workdayEnd));
}
export function isWithinAssistantQuietHours(organization, now) {
    const { quietHoursStart, quietHoursEnd } = organization.settings.ai;
    if (!quietHoursStart || !quietHoursEnd)
        return false;
    return withinWindow(localClock(now, organization.timezone).minutes, quietHoursStart, quietHoursEnd);
}
export function hasActiveAppointment(appointments, professionalId, now) {
    if (!professionalId)
        return false;
    const at = Date.parse(now);
    return appointments.some((appointment) => appointment.professionalId === professionalId &&
        (appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED") &&
        Date.parse(appointment.startsAt) <= at &&
        Date.parse(appointment.endsAt) > at);
}
export function assistantReplySchedule(input) {
    if (input.activeAppointment) {
        return { scheduledFor: input.now, trigger: "ACTIVE_APPOINTMENT" };
    }
    if (!isWithinBusinessHours(input.organization, input.now)) {
        return { scheduledFor: input.now, trigger: "OUTSIDE_BUSINESS_HOURS" };
    }
    const configured = input.organization.settings.ai.unansweredDelayMinutes;
    const delay = Math.min(ASSISTANT_REPLY_DELAY_MINUTES.max, Math.max(ASSISTANT_REPLY_DELAY_MINUTES.min, configured));
    return {
        scheduledFor: addMinutes(input.now, delay),
        trigger: "HUMAN_RESPONSE_TIMEOUT",
    };
}
