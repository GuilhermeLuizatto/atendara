"use client";

import { X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";
import { useDialogFocus } from "@/lib/utils/use-dialog-focus";

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
 * O teclado fica dentro do dialogo enquanto ele existir e volta para quem o
 * abriu quando fecha (`useDialogFocus`). Titulo e descricao sao ligados por id,
 * para o leitor de tela anunciar os dois ao entrar.
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
  const titleId = useId();
  const descriptionId = useId();
  useDialogFocus(open, panelRef, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6">
      {/* So o mouse fecha por aqui; o teclado usa Escape ou o botao Fechar. */}
      <div
        aria-hidden
        onClick={onClose}
        className="bg-foreground/40 absolute inset-0 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "border-border bg-surface shadow-overlay relative flex max-h-[90dvh] w-full flex-col border outline-none",
          "rounded-t-2xl sm:rounded-card",
          SIZES[size],
        )}
      >
        <div className="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-foreground text-sm font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-muted-foreground mt-0.5 text-xs">
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
