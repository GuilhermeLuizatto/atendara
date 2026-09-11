"use client";

import { cn } from "@/lib/utils/cn";
import {
  dayOfMonth,
  isSameMonth,
  shortWeekdayLabel,
  type DateKey,
} from "@/lib/utils/datetime";
import { formatTime } from "@/lib/utils/format";
import type { Appointment } from "@/types";

const CHIPS_PER_CELL = 3;

const STATUS_DOT: Record<Appointment["status"], string> = {
  SCHEDULED: "bg-primary",
  CONFIRMED: "bg-success",
  COMPLETED: "bg-border-strong",
  CANCELLED: "bg-danger",
  NO_SHOW: "bg-warning",
  RESCHEDULED: "bg-info",
};

/**
 * Visao mensal.
 *
 * Densidade acima de detalhe: o objetivo aqui e enxergar carga e dias vazios de
 * relance. Cada celula mostra ate tres atendimentos e resume o resto — clicar
 * no dia leva para a visao diaria, que tem o detalhe.
 */
export function MonthView({
  cursor,
  days,
  byDay,
  today,
  onSelectDay,
  onSelectAppointment,
}: {
  cursor: DateKey;
  days: DateKey[];
  byDay: Map<DateKey, Appointment[]>;
  today: DateKey;
  onSelectDay: (dateKey: DateKey) => void;
  onSelectAppointment: (appointment: Appointment) => void;
}) {
  return (
    <div>
      <div className="border-border grid grid-cols-7 border-b">
        {days.slice(0, 7).map((key) => (
          <div
            key={key}
            className="text-subtle-foreground px-2 py-2 text-center text-[11px] font-medium tracking-wide uppercase"
          >
            {shortWeekdayLabel(key)}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((key) => {
          const appointments = byDay.get(key) ?? [];
          const outside = !isSameMonth(key, cursor);
          const isToday = key === today;

          return (
            <div
              key={key}
              className={cn(
                "border-border min-h-24 border-r border-b p-1.5 last:border-r-0",
                outside && "bg-surface-inset",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectDay(key)}
                className={cn(
                  "mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                  isToday
                    ? "bg-accent text-accent-foreground font-semibold"
                    : outside
                      ? "text-subtle-foreground hover:bg-surface-muted"
                      : "text-foreground hover:bg-surface-muted",
                )}
                aria-label={`Ver dia ${dayOfMonth(key)}, ${appointments.length} atendimento(s)`}
              >
                {dayOfMonth(key)}
              </button>

              <ul className="space-y-0.5">
                {appointments.slice(0, CHIPS_PER_CELL).map((appointment) => (
                  <li key={appointment.id}>
                    <button
                      type="button"
                      onClick={() => onSelectAppointment(appointment)}
                      className="hover:bg-surface-muted flex min-h-6 w-full items-center gap-1 rounded px-1 text-left transition-colors"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          STATUS_DOT[appointment.status],
                        )}
                      />
                      <span className="text-subtle-foreground shrink-0 text-[10px] tabular-nums">
                        {formatTime(appointment.startsAt)}
                      </span>
                      <span className="text-foreground truncate text-[11px]">
                        {appointment.clientName}
                      </span>
                    </button>
                  </li>
                ))}

                {appointments.length > CHIPS_PER_CELL ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => onSelectDay(key)}
                      className="text-muted-foreground hover:text-foreground min-h-6 px-1 text-[11px] transition-colors"
                    >
                      + {appointments.length - CHIPS_PER_CELL} outros
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
