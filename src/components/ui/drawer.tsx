"use client";

import { X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";
import { useDialogFocus } from "@/lib/utils/use-dialog-focus";

import { Button } from "./button";

/**
 * Painel lateral para detalhe de registro.
 *
 * Preferido ao modal quando o usuario precisa manter a lista como contexto —
 * abrir a ficha de um cliente sem perder de vista onde ele estava na tabela.
 * Em telas estreitas ocupa a largura toda, virando efetivamente uma pagina.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useDialogFocus(open, panelRef, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <div
        aria-hidden
        onClick={onClose}
        className="bg-foreground/40 absolute inset-0 backdrop-blur-[2px]"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "border-border bg-surface shadow-overlay absolute inset-y-0 right-0 flex w-full flex-col border-l outline-none",
          "sm:max-w-md",
        )}
      >
        <div className="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-foreground truncate text-sm font-semibold">
              {title}
            </h2>
            {subtitle ? (
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {subtitle}
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

        {footer ? (
          <div className="border-border border-t px-5 py-3">{footer}</div>
        ) : null}
      </aside>
    </div>
  );
}
