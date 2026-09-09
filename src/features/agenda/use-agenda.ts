"use client";

import { useCallback, useMemo, useState } from "react";

import {
  monthGridKeys,
  shiftDays,
  toDateKey,
  weekKeys,
  type DateKey,
} from "@/lib/utils/datetime";
import { useWorkspace } from "@/providers/workspace-provider";
import type { Appointment, ID } from "@/types";

export type AgendaMode = "day" | "week" | "month";

/**
 * Estado da agenda: modo de visualizacao, data em foco e filtros.
 *
 * O "cursor" e uma data de calendario, nao um instante. Navegar entre dias,
 * semanas e meses vira aritmetica sobre essa chave — sem risco de o dia mudar
 * por causa de fuso ao somar 24 horas a um timestamp.
 */
export function useAgenda() {
  const { data } = useWorkspace();

  const [mode, setMode] = useState<AgendaMode>("day");
  const [cursor, setCursor] = useState<DateKey>(() => toDateKey(new Date()));
  const [professionalId, setProfessionalId] = useState<ID | "ALL">("ALL");
  const [showCancelled, setShowCancelled] = useState(false);

  const today = toDateKey(new Date());

  const visibleDays = useMemo<DateKey[]>(() => {
    if (mode === "day") return [cursor];
    if (mode === "week") return weekKeys(cursor);
    return monthGridKeys(cursor);
  }, [mode, cursor]);

  const appointments = useMemo(() => {
    const all = data?.appointments ?? [];
    return all.filter((appointment) => {
      if (!showCancelled && appointment.status === "CANCELLED") return false;
      if (
        professionalId !== "ALL" &&
        appointment.professionalId !== professionalId
      ) {
        return false;
      }
      return true;
    });
  }, [data, professionalId, showCancelled]);

  /** Indexado por dia: cada celula do calendario le direto, sem varrer a lista. */
  const byDay = useMemo(() => {
    const map = new Map<DateKey, Appointment[]>();
    for (const appointment of appointments) {
      const key = toDateKey(new Date(appointment.startsAt));
      const bucket = map.get(key);
      if (bucket) bucket.push(appointment);
      else map.set(key, [appointment]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [appointments]);

  const step = mode === "day" ? 1 : mode === "week" ? 7 : 0;

  const goPrevious = useCallback(() => {
    setCursor((current) =>
      step > 0 ? shiftDays(current, -step) : previousMonth(current),
    );
  }, [step]);

  const goNext = useCallback(() => {
    setCursor((current) =>
      step > 0 ? shiftDays(current, step) : nextMonth(current),
    );
  }, [step]);

  const goToday = useCallback(() => setCursor(toDateKey(new Date())), []);

  const visibleCount = useMemo(
    () =>
      visibleDays.reduce(
        (total, key) => total + (byDay.get(key)?.length ?? 0),
        0,
      ),
    [visibleDays, byDay],
  );

  return {
    mode,
    setMode,
    cursor,
    setCursor,
    today,
    visibleDays,
    byDay,
    visibleCount,
    goPrevious,
    goNext,
    goToday,
    professionalId,
    setProfessionalId,
    showCancelled,
    setShowCancelled,
    professionals: data?.professionals ?? [],
    settings: data?.organization.settings.agenda ?? null,
  };
}

function previousMonth(key: DateKey): DateKey {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1, 12));
  return date.toISOString().slice(0, 10);
}

function nextMonth(key: DateKey): DateKey {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1, 12));
  return date.toISOString().slice(0, 10);
}
