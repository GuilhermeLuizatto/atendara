"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Pilha dos dialogos abertos. So o do topo responde a teclado: com uma
 * confirmacao aberta sobre uma gaveta, Escape fecha a confirmacao e mais nada.
 */
const openDialogs: symbol[] = [];

function focusablesIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

/**
 * Comportamento de dialogo modal (WCAG 2.1.2, 2.4.3): o foco entra ao abrir,
 * Tab e Shift+Tab nao saem do painel, Escape fecha e, ao fechar, o foco volta
 * para quem abriu. A pagina de tras nao rola enquanto o dialogo existir.
 *
 * `onClose` fica numa ref: quem chama costuma passar uma funcao nova a cada
 * render, e reexecutar o efeito jogaria o foco de volta para o primeiro campo
 * no meio da digitacao.
 */
export function useDialogFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const id = Symbol("dialog");
    openDialogs.push(id);
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    (focusablesIn(panel)[0] ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== id) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusablesIn(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openDialogs.splice(openDialogs.indexOf(id), 1);
      if (openDialogs.length === 0) document.body.style.overflow = previousOverflow;
      // Quem abriu pode ter sumido com a propria acao (o guia some ao agendar o
      // primeiro atendimento); o foco vai para o conteudo, nao para o topo.
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLElement>("main")?.focus();
    };
  }, [open, panelRef]);
}
