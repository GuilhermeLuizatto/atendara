"use client";

import { useEffect, type RefObject } from "react";

/**
 * Fecha um painel flutuante ao clicar fora ou pressionar Escape.
 *
 * Os listeners so sao registrados enquanto o painel esta aberto — um listener
 * global permanente por dropdown se acumula e custa em cada clique da pagina.
 * No Escape o foco volta para o botao que abriu: sem isso, quem navega por
 * teclado cai no inicio da pagina.
 */
export function useDismissable(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  returnFocusRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onDismiss();
      returnFocusRef?.current?.focus();
    };
    // Tab para fora do painel tambem fecha: um menu aberto atras do foco some
    // da vista de quem so usa teclado.
    const onFocusIn = (event: FocusEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onDismiss();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, containerRef, onDismiss, returnFocusRef]);
}
