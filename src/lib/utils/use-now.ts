"use client";

import { useEffect, useState } from "react";

/**
 * Relogio que avanca em intervalos fixos.
 *
 * O dashboard mostra "em 25 min" e destaca o atendimento atual; sem um tique
 * periodico esses textos congelam no instante da montagem. Um minuto e
 * suficiente: a granularidade exibida e de minutos.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
