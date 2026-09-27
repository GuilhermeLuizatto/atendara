import { weekdayOf, type DateKey } from "@/lib/utils/datetime";
import type { AgendaSettings } from "@/types";

/**
 * O horário escolhido à mão cai fora do expediente configurado?
 *
 * Avisa, não bloqueia: encaixe no sábado ou depois do horário é decisão de
 * quem atende, como marcar por cima de um compromisso do Google (decisão do
 * titular de 24/09). A oferta automática de horários, que fala com o cliente
 * sem ninguém olhar, continua presa ao expediente em `availability.ts`.
 */
export type WorkingScheduleWarning = "OFF_DAY" | "OUTSIDE_HOURS" | null;

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isWorkingDay(
  agenda: Pick<AgendaSettings, "workingDays">,
  date: DateKey,
): boolean {
  return agenda.workingDays.includes(weekdayOf(date));
}

export function workingScheduleWarning(
  agenda: Pick<AgendaSettings, "workingDays" | "workdayStart" | "workdayEnd">,
  date: DateKey,
  time: string,
  durationMinutes: number,
): WorkingScheduleWarning {
  if (!isWorkingDay(agenda, date)) return "OFF_DAY";
  const start = minutesOf(time);
  const end = start + Math.max(0, durationMinutes);
  if (start < minutesOf(agenda.workdayStart) || end > minutesOf(agenda.workdayEnd)) {
    return "OUTSIDE_HOURS";
  }
  return null;
}
