"use client";

import { busyConflicts } from "@/lib/agenda/calendar";
import { cn } from "@/lib/utils/cn";
import { addMinutesISO, fromDateAndTime } from "@/lib/utils/datetime";
import { formatTime } from "@/lib/utils/format";
import { useNow } from "@/lib/utils/use-now";
import type { CalendarBusySnapshot } from "@/types/calendar";

/**
 * Aviso de compromisso no Google no horário escolhido (3C, frente 2).
 *
 * Avisa e deixa marcar — decisão do titular de 24/09: a leitura tem até meia
 * hora, e bloquear travaria a equipe num compromisso que talvez já tenha sido
 * desmarcado. Sem leitura recente, diz que não dá para conferir em vez de
 * sugerir que o horário está livre. Sem conexão, não diz nada.
 */
export function BusyConflictNotice({
  professionalId,
  professionalName,
  date,
  time,
  durationMinutes,
  snapshots,
  className,
}: {
  professionalId: string;
  professionalName: string;
  date: string;
  time: string;
  durationMinutes: string;
  snapshots: readonly CalendarBusySnapshot[];
  className?: string;
}) {
  const now = useNow();
  const duration = Number(durationMinutes);
  if (!professionalId || !date || !time || !Number.isFinite(duration) || duration <= 0) return null;

  const startsAt = fromDateAndTime(date, time);
  const check = busyConflicts({
    startsAt,
    endsAt: addMinutesISO(startsAt, duration),
    professionalId,
    snapshots,
    now: now.toISOString(),
  });

  if (check.status === "ABSENT") return null;
  if (check.status === "STALE") {
    return (
      <p role="status" className={cn("text-muted-foreground text-sm", className)}>
        A leitura da agenda Google de {professionalName} está desatualizada: não
        dá para conferir se este horário está livre por lá.
      </p>
    );
  }
  if (check.conflicts.length === 0) return null;

  const intervals = check.conflicts
    .map((block) => `${formatTime(block.startsAt)}–${formatTime(block.endsAt)}`)
    .join(", ");
  return (
    <p
      role="status"
      className={cn("bg-warning-soft text-warning-soft-foreground rounded-lg px-3 py-2 text-sm", className)}
    >
      Este horário cruza um compromisso no Google de {professionalName} (
      {intervals}). Você pode marcar mesmo assim.
    </p>
  );
}
