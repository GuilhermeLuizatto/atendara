"use client";

import { Button } from "./button";
import { Modal } from "./modal";

/**
 * Confirmacao para acao destrutiva.
 *
 * A acao perigosa nunca e o botao padrao e nunca recebe o foco inicial: o foco
 * cai em "Cancelar", entao um Enter reflexo nao apaga nada.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirmar",
  destructive = true,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-muted-foreground text-sm leading-relaxed">{message}</p>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          size="sm"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
