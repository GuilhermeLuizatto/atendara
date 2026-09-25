"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormActions, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { PAYMENT_METHOD_LABELS } from "@/config/labels";
import {
  RECURRING_LIMITS,
  periodLabel,
  shiftPeriod,
  validateRecurringCharge,
  type RecurringChargeInput,
} from "@/lib/finance/recurring";
import { toDateKey } from "@/lib/utils/datetime";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { PaymentMethod, RecurringCharge } from "@/types";

/** Valor digitado ("450,00") em centavos inteiros; nunca passa por float somado. */
function toCents(text: string): number {
  const clean = text.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return NaN;
  const [reais, centavos = ""] = clean.split(".");
  return Number(reais) * 100 + Number(centavos.padEnd(2, "0"));
}

function centsText(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

export function RecurringForm({
  charge,
  currentPeriod,
  onClose,
}: {
  charge: RecurringCharge | null;
  currentPeriod: string;
  onClose: () => void;
}) {
  const { data, terminology } = useWorkspace();
  const { run } = useWorkspaceActions();
  const [clientId, setClientId] = useState(charge?.clientId ?? "");
  const [description, setDescription] = useState(charge?.description ?? "");
  const [amount, setAmount] = useState(charge ? centsText(charge.amountInCents) : "");
  const [dueDay, setDueDay] = useState(String(charge?.dueDay ?? 10));
  const [method, setMethod] = useState<PaymentMethod | "">(charge?.method ?? "PIX");
  const [startPeriod, setStartPeriod] = useState(charge?.startPeriod ?? currentPeriod);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: RecurringChargeInput = {
      clientId,
      professionalId: charge?.professionalId ?? null,
      description,
      amountInCents: toCents(amount),
      method: method || null,
      dueDay: Number(dueDay),
      startPeriod,
    };
    const validation = validateRecurringCharge(input);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    setSaving(true);
    const { description: text, amountInCents, method: chosen, dueDay: day } = validation.value;
    const done = charge
      ? await run(
          (repo) => repo.updateRecurringCharge(charge.id, { description: text, amountInCents, method: chosen, dueDay: day }).then(() => true),
          "Mensalidade atualizada. Vale a partir do próximo mês lançado.",
        )
      : await run((repo) => repo.createRecurringCharge(validation.value), "Mensalidade criada.");
    setSaving(false);
    if (done) onClose();
  }

  const starts = [0, 1, 2].map((months) => shiftPeriod(currentPeriod, months));
  const today = Number(toDateKey(new Date()).slice(8, 10));

  return (
    <Modal
      open
      onClose={onClose}
      title={charge ? "Editar mensalidade" : "Nova mensalidade"}
      description={`O pagamento vai direto para você; o Atendara lança o mês e acompanha quem pagou.`}
      size="md"
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={`Quem paga (${terminology.client.singularLower})`} required>
              {(props) => (
                <Select {...props} required disabled={Boolean(charge)} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Escolha</option>
                  {data?.clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.fullName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Descrição" required>
              {(props) => (
                <Input
                  {...props}
                  required
                  maxLength={RECURRING_LIMITS.descriptionMax}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex.: Acompanhamento mensal"
                />
              )}
            </Field>
          </div>
          <Field label="Valor por mês (R$)" required>
            {(props) => <Input {...props} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="450,00" />}
          </Field>
          <Field label="Dia do vencimento" required>
            {(props) => (
              <Select {...props} value={dueDay} onChange={(e) => setDueDay(e.target.value)}>
                {Array.from({ length: RECURRING_LIMITS.dueDayMax }, (_, index) => String(index + 1)).map((day) => (
                  <option key={day} value={day}>
                    Dia {day}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Forma de pagamento combinada">
            {(props) => (
              <Select {...props} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}>
                <option value="">Não informada</option>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Primeiro mês cobrado">
            {(props) => (
              <Select {...props} disabled={Boolean(charge)} value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)}>
                {(charge ? [charge.startPeriod] : starts).map((period) => (
                  <option key={period} value={period}>
                    {periodLabel(period)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {!charge && startPeriod === currentPeriod && Number(dueDay) < today && (
          <p role="status" className="text-warning-soft-foreground text-sm">
            O vencimento do dia {dueDay} deste mês já passou: o primeiro mês nasce em atraso. Para começar no próximo vencimento, escolha {periodLabel(shiftPeriod(currentPeriod, 1))}.
          </p>
        )}
        {charge && (
          <p className="text-muted-foreground text-xs">
            Mudar valor ou vencimento vale a partir do próximo mês lançado; o mês já lançado continua como está.
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando..." : charge ? "Salvar mensalidade" : "Criar mensalidade"}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
