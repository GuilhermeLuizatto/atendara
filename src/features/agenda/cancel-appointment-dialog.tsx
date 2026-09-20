"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  DEFAULT_DEPOSIT_CHOICE,
  DEPOSIT_CHOICES,
  DEPOSIT_CHOICE_LABELS,
  type DepositChoice,
} from "@/config/deposit";
import { formatCurrency } from "@/lib/utils/format";

/**
 * Cancelamento de atendimento (E2.2).
 *
 * Quando há sinal **pago**, a tela pergunta o destino dele antes de cancelar —
 * é dinheiro da cliente mudando de lugar, e isso não acontece por omissão. Reter
 * vem marcado, porque é para isso que o sinal existe, e a escolha vai para a
 * trilha em qualquer um dos dois casos.
 */
export function CancelAppointmentDialog({
  open,
  clientName,
  depositInCents,
  onClose,
  onConfirm,
}: {
  open: boolean;
  clientName: string;
  /** Sinal **pago** deste atendimento. `null` quando não há o que decidir. */
  depositInCents: number | null;
  onClose: () => void;
  onConfirm: (choice: DepositChoice | null) => void;
}) {
  const [choice, setChoice] = useState<DepositChoice>(DEFAULT_DEPOSIT_CHOICE);

  return (
    <Modal open={open} onClose={onClose} title="Cancelar atendimento" size="sm">
      <p className="text-muted-foreground text-sm leading-relaxed">
        O atendimento de {clientName} será cancelado, e a cobrança pendente
        vinculada também.
      </p>

      {depositInCents !== null ? (
        <fieldset className="mt-4 space-y-2">
          <legend className="text-foreground text-sm font-medium">
            O sinal de {formatCurrency(depositInCents)} já foi pago. O que fazer
            com ele?
          </legend>
          {DEPOSIT_CHOICES.map((option) => (
            <label key={option} className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="destino-do-sinal"
                className="border-input accent-accent mt-0.5 size-4"
                checked={choice === option}
                onChange={() => setChoice(option)}
              />
              <span>
                <span className="text-foreground">
                  {DEPOSIT_CHOICE_LABELS[option]}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {option === "KEEP"
                    ? "O valor fica com você e aparece como recebido no financeiro."
                    : "O lançamento vira devolução, e o valor sai do seu recebido."}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Voltar
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            onConfirm(depositInCents === null ? null : choice);
            onClose();
          }}
        >
          Cancelar atendimento
        </Button>
      </div>
    </Modal>
  );
}
