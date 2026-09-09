"use client";

import { useEffect, type RefObject } from "react";

/**
 * Fecha um painel flutuante ao clicar fora ou pressionar Escape.
 *
 * Os listeners so sao registrados enquanto o painel esta aberto — um listener
 * global permanente por dropdown se acumula e custa em cada clique da pagina.
 */
export function useDismissable(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, containerRef, onDismiss]);
}
