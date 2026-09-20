"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormActions, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { SERVICE_LIMITS } from "@/config/services";
import { validateService } from "@/lib/agenda/services";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { ServiceInput } from "@/services";
import type { Service } from "@/types";

/**
 * Formulario de servico do catalogo (E2.1).
 *
 * Preco e duracao abrem **vazios** em servico novo: o Atendara nao sugere
 * valor, e um campo pre-preenchido seria uma sugestao. Quem cobra sabe quanto
 * cobra.
 */

interface Draft {
  name: string;
  description: string;
  durationMinutes: string;
  priceInReais: string;
  enabled: boolean;
  returnIntervalDays: string;
}

function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function reaisToCents(value: string): number | null {
  const texto = value.trim();
  if (!texto) return null;
  const numero = Number(texto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) ? Math.round(numero * 100) : Number.NaN;
}

function toNumberOrNull(value: string): number | null {
  const texto = value.trim();
  if (!texto) return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : Number.NaN;
}

function draftFrom(service: Service | null): Draft {
  return {
    name: service?.name ?? "",
    description: service?.description ?? "",
    durationMinutes:
      service?.durationMinutes === null || service === null
        ? ""
        : String(service.durationMinutes),
    priceInReais: centsToInput(service?.priceInCents ?? null),
    enabled: service?.enabled ?? false,
    returnIntervalDays:
      service?.returnIntervalDays === null || service === null
        ? ""
        : String(service.returnIntervalDays),
  };
}

export function ServiceForm({
  open,
  service,
  onClose,
}: {
  open: boolean;
  service: Service | null;
  onClose: () => void;
}) {
  const { data } = useWorkspace();
  const { createService, updateService } = useWorkspaceActions();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(service));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (changes: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  function toInput(): ServiceInput {
    return {
      name: draft.name,
      description: draft.description.trim() || null,
      durationMinutes: toNumberOrNull(draft.durationMinutes),
      priceInCents: reaisToCents(draft.priceInReais),
      enabled: draft.enabled,
      returnIntervalDays: toNumberOrNull(draft.returnIntervalDays),
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const input = toInput();

    // A mesma validacao do repositorio, antes de ir: a tela nao inventa regra
    // propria, so adianta a resposta.
    const validation = validateService(input, {
      existing: data?.services ?? [],
      editingId: service?.id ?? null,
    });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);

    setSaving(true);
    const result = service
      ? await updateService(service.id, validation.value)
      : await createService(validation.value);
    setSaving(false);

    if (result !== null) onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={service ? "Editar serviço" : "Novo serviço"}
      description="A duração e o valor são seus. O Atendara não sugere preço."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <p
            className="bg-danger-soft text-danger-soft-foreground rounded-lg px-3 py-2 text-sm"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <Field label="Nome" required>
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              maxLength={SERVICE_LIMITS.name.max}
              onChange={(event) => patch({ name: event.target.value })}
              invalid={Boolean(error)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Duração (minutos)"
            hint="Quanto o atendimento ocupa na agenda."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={SERVICE_LIMITS.durationMinutes.min}
                max={SERVICE_LIMITS.durationMinutes.max}
                step={5}
                value={draft.durationMinutes}
                onChange={(event) =>
                  patch({ durationMinutes: event.target.value })
                }
              />
            )}
          </Field>

          <Field
            label="Valor (R$)"
            hint="O valor que você cobra por este serviço."
          >
            {(props) => (
              <Input
                {...props}
                type="text"
                inputMode="decimal"
                value={draft.priceInReais}
                onChange={(event) =>
                  patch({ priceInReais: event.target.value })
                }
              />
            )}
          </Field>

          <Field
            label="Retorno sugerido (dias)"
            hint="Aparece na tela depois do atendimento. Não envia mensagem."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={SERVICE_LIMITS.returnIntervalDays.min}
                max={SERVICE_LIMITS.returnIntervalDays.max}
                value={draft.returnIntervalDays}
                onChange={(event) =>
                  patch({ returnIntervalDays: event.target.value })
                }
              />
            )}
          </Field>
        </div>

        <Field
          label="Descrição"
          hint="Para a sua equipe. Não sai em aviso ao cliente."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={SERVICE_LIMITS.description.max}
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          )}
        </Field>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="border-input accent-accent mt-0.5 size-4 rounded"
            checked={draft.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          <span>
            <span className="text-foreground font-medium">
              Disponível para agendar
            </span>
            <span className="text-muted-foreground block text-xs">
              Só liga com duração e valor preenchidos.
            </span>
          </span>
        </label>

        <FormActions>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
