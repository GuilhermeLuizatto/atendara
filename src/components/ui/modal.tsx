"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { Button } from "./button";

type ModalSize = "sm" | "md" | "lg";

const SIZES: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

/**
 * Dialogo modal.
 *
 * Tres comportamentos que costumam faltar em modais improvisados e que sao
 * requisito de acessibilidade: Escape fecha, o foco vai para dentro ao abrir, e
 * a pagina de tras nao rola enquanto o dialogo estiver aberto.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Leva o foco para o primeiro controle; sem isso o teclado continuaria
    // navegando a pagina atras do dialogo.
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button, [tabindex]:not([tabindex='-1'])",
    );
    focusable?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="bg-foreground/40 absolute inset-0 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "border-border bg-surface shadow-overlay relative flex max-h-[90dvh] w-full flex-col border",
          "rounded-t-2xl sm:rounded-card",
          SIZES[size],
        )}
      >
        <div className="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-foreground text-sm font-semibold">{title}</h2>
            {description ? (
              <p className="text-muted-foreground mt-0.5 text-xs">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Fechar"
            className="-mt-1 -mr-1 shrink-0"
          >
            <X className="size-4" aria-hidden strokeWidth={1.75} />
          </Button>
        </div>

        <div className="scrollbar-slim flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
