"use client";

import { APPOINTMENT_STATUS_LABELS, MODALITY_LABELS } from "@/config/labels";
import { cn } from "@/lib/utils/cn";
import {
  dayLabel,
  minutesIntoDay,
  toDateKey,
  type DateKey,
} from "@/lib/utils/datetime";
import { formatTime } from "@/lib/utils/format";
import type { Appointment } from "@/types";

import { layoutDay } from "./layout";

export const PIXELS_PER_HOUR = 64;

const STATUS_STYLES: Record<Appointment["status"], string> = {
  SCHEDULED: "border-l-primary bg-primary-soft/60 text-foreground",
  CONFIRMED: "border-l-success bg-success-soft/70 text-foreground",
  COMPLETED: "border-l-border-strong bg-surface-muted text-muted-foreground",
  CANCELLED:
    "border-l-danger bg-danger-soft/40 text-muted-foreground line-through",
  NO_SHOW: "border-l-warning bg-warning-soft/60 text-foreground",
  RESCHEDULED: "border-l-info bg-info-soft/60 text-foreground",
};

/** Régua de horas, compartilhada pelas visoes de dia e semana. */
export function HourRuler({
  startHour,
  endHour,
}: {
  startHour: number;
  endHour: number;
}) {
  return (
    <div className="w-12 shrink-0 select-none sm:w-14">
      {Array.from({ length: endHour - startHour }, (_, index) => (
        <div
          key={index}
          style={{ height: PIXELS_PER_HOUR }}
          className="border-border relative border-b"
        >
          <span className="text-subtle-foreground absolute -top-2 right-2 text-[11px] tabular-nums">
            {String(startHour + index).padStart(2, "0")}:00
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Uma coluna de dia com os atendimentos posicionados por horario.
 *
 * A grade e absoluta em vez de uma lista: e a unica forma de mostrar duracao e
 * espaco vago — a informacao que o profissional realmente busca ao olhar a
 * agenda ("tenho uma hora livre depois do almoco?").
 */
export function DayColumn({
  dateKey,
  appointments,
  startHour,
  endHour,
  now,
  compact = false,
  onSelect,
  onCreateAt,
}: {
  dateKey: DateKey;
  appointments: Appointment[];
  startHour: number;
  endHour: number;
  now: Date;
  compact?: boolean;
  onSelect: (appointment: Appointment) => void;
  onCreateAt: (dateKey: DateKey, time: string) => void;
}) {
  const positioned = layoutDay(appointments, startHour, PIXELS_PER_HOUR);
  const hours = endHour - startHour;
  const isToday = toDateKey(now) === dateKey;
  const nowOffset =
    (minutesIntoDay(now.toISOString()) - startHour * 60) * (PIXELS_PER_HOUR / 60);
  const showNowLine = isToday && nowOffset >= 0 && nowOffset <= hours * PIXELS_PER_HOUR;

  return (
    <div
      className="relative flex-1"
      style={{ height: hours * PIXELS_PER_HOUR }}
    >
      {/* Faixas de hora clicaveis: agendar comeca pelo horario vago. */}
      {Array.from({ length: hours }, (_, index) => {
        const hour = startHour + index;
        return (
          <button
            key={hour}
            type="button"
            onClick={() =>
              onCreateAt(dateKey, `${String(hour).padStart(2, "0")}:00`)
            }
            aria-label={`Agendar em ${dayLabel(dateKey)}, às ${String(hour).padStart(2, "0")}:00`}
            style={{ height: PIXELS_PER_HOUR }}
            className="border-border hover:bg-surface-muted/50 block w-full border-b transition-colors"
          />
        );
      })}

      {showNowLine ? (
        <div
          aria-hidden
          style={{ top: nowOffset }}
          className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
        >
          <span className="bg-danger size-1.5 shrink-0 rounded-full" />
          <span className="bg-danger h-px flex-1" />
        </div>
      ) : null}

      {positioned.map(({ appointment, top, height, lane, lanes }) => (
        <button
          key={appointment.id}
          type="button"
          onClick={() => onSelect(appointment)}
          aria-label={`${formatTime(appointment.startsAt)}, ${appointment.clientName}, ${APPOINTMENT_STATUS_LABELS[appointment.status]}, ${MODALITY_LABELS[appointment.modality]}`}
          style={{
            top,
            height,
            left: `calc(${(lane / lanes) * 100}% + 2px)`,
            width: `calc(${100 / lanes}% - 4px)`,
          }}
          className={cn(
            "absolute z-10 overflow-hidden rounded-md border-l-2 px-2 py-1 text-left",
            "shadow-card transition-shadow hover:shadow-raised",
            STATUS_STYLES[appointment.status],
          )}
        >
          <p className="truncate text-[11px] font-semibold tabular-nums">
            {formatTime(appointment.startsAt)}
          </p>
          <p className="truncate text-xs font-medium">
            {appointment.clientName}
          </p>
          {!compact && height > 52 ? (
            <p className="truncate text-[11px] opacity-80">
              {MODALITY_LABELS[appointment.modality]} ·{" "}
              {APPOINTMENT_STATUS_LABELS[appointment.status]}
            </p>
          ) : null}
        </button>
      ))}
    </div>
  );
}
