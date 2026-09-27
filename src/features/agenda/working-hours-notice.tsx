"use client";

import { WEEKDAY_LABELS } from "@/config/labels";
import { workingScheduleWarning } from "@/lib/agenda/working-hours";
import { cn } from "@/lib/utils/cn";
import { weekdayOf } from "@/lib/utils/datetime";
import type { AgendaSettings } from "@/types";

/**
 * Aviso de horário fora do expediente configurado em Configurações → Agenda.
 *
 * Avisa e deixa marcar, como o aviso de compromisso no Google: o encaixe é
 * decisão de quem atende. O que não pode é a tela oferecer o sábado fechado
 * como se fosse um dia qualquer.
 */
export function WorkingHoursNotice({
  agenda,
  date,
  time,
  durationMinutes,
  className,
}: {
  agenda: Pick<AgendaSettings, "workingDays" | "workdayStart" | "workdayEnd"> | null;
  date: string;
  time: string;
  durationMinutes: string;
  className?: string;
}) {
  const duration = Number(durationMinutes);
  if (!agenda || !date || !time) return null;
  const warning = workingScheduleWarning(
    agenda,
    date,
    time,
    Number.isFinite(duration) ? duration : 0,
  );
  if (warning === null) return null;

  return (
    <p
      role="status"
      className={cn("bg-warning-soft text-warning-soft-foreground rounded-lg px-3 py-2 text-sm", className)}
    >
      {warning === "OFF_DAY"
        ? `${WEEKDAY_LABELS[weekdayOf(date)]} não é dia de atendimento na configuração da agenda.`
        : `Este horário sai do expediente (${agenda.workdayStart}–${agenda.workdayEnd}).`}{" "}
      Você pode marcar mesmo assim.
    </p>
  );
}
