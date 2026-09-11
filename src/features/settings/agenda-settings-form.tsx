"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { MODALITY_LABELS, WEEKDAY_LABELS } from "@/config/labels";
import { AGENDA_SLOT_INTERVALS } from "@/config/organization";
import { formatCurrency } from "@/lib/utils/format";
import { byGender } from "@/lib/utils/terms";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { AgendaSettings, ServiceModality } from "@/types";

/**
 * Horario de atendimento da organizacao.
 *
 * Editar e ato administrativo (`organization:update`). Para quem nao tem esse
 * papel — inclusive o titular autonomo — a tela mostra o horario e diz o que
 * ele muda na pratica, sem oferecer um botao que o servidor recusaria.
 */
export function AgendaSettingsForm({
  onDone,
  doneLabel = "Salvar horario",
}: {
  /** Chamado depois de salvar, ou de confirmar a leitura quando nao pode editar. */
  onDone?: () => void;
  doneLabel?: string;
}) {
  const { data, profession, terminology, session } = useWorkspace();
  const { updateAgendaSettings } = useWorkspaceActions();
  const current = data?.organization.settings.agenda;
  const [draft, setDraft] = useState<AgendaSettings | null>(current ?? null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!current || !draft) return null;
  const canEdit = session?.permissions.includes("organization:update") ?? false;

  const defaults = (
    <p className="text-muted-foreground text-sm">
      Cada {terminology.appointment.singularLower}{" "}
      {byGender(terminology.appointment, "novo", "nova")} comeca com{" "}
      {profession.defaultAppointmentDurationMinutes} minutos e{" "}
      {formatCurrency(profession.defaultPriceInCents)}. Da para mudar os dois em
      cada agendamento.
    </p>
  );

  if (!canEdit) {
    return (
      <div className="space-y-3">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Dias</dt>
            <dd className="text-foreground">
              {current.workingDays.map((day) => WEEKDAY_LABELS[day]).join(", ")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Horario</dt>
            <dd className="text-foreground">
              {current.workdayStart} as {current.workdayEnd}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Intervalo da grade</dt>
            <dd className="text-foreground">{current.slotIntervalMinutes} minutos</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Modalidade padrao</dt>
            <dd className="text-foreground">{MODALITY_LABELS[current.defaultModality]}</dd>
          </div>
        </dl>
        {defaults}
        <p className="text-muted-foreground text-sm">
          Este horario so e alterado por quem administra a organizacao. Na
          pratica ele nao limita nada: a agenda aceita e mostra qualquer horario
          que voce marcar, inclusive fora dele.
        </p>
        {onDone ? (
          <Button variant="secondary" size="sm" onClick={onDone}>
            {doneLabel}
          </Button>
        ) : null}
      </div>
    );
  }

  const patch = (changes: Partial<AgendaSettings>) =>
    setDraft((value) => (value ? { ...value, ...changes } : value));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (draft.workingDays.length === 0) {
      setError("Escolha ao menos um dia de atendimento.");
      return;
    }
    if (draft.workdayStart >= draft.workdayEnd) {
      setError("O inicio do expediente precisa ser antes do fim.");
      return;
    }
    setError("");
    setSaving(true);
    const result = await updateAgendaSettings(draft);
    setSaving(false);
    if (result !== null) onDone?.();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="text-foreground mb-2 text-xs font-medium">Dias de atendimento</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {WEEKDAY_LABELS.map((label, day) => (
            <label key={label} className="text-foreground flex min-h-6 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={draft.workingDays.includes(day)}
                onChange={(event) =>
                  patch({
                    workingDays: event.target.checked
                      ? [...draft.workingDays, day]
                      : draft.workingDays.filter((item) => item !== day),
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Inicio do expediente">
          {(props) => (
            <Input
              {...props}
              type="time"
              required
              value={draft.workdayStart}
              onChange={(event) => patch({ workdayStart: event.target.value })}
            />
          )}
        </Field>
        <Field label="Fim do expediente">
          {(props) => (
            <Input
              {...props}
              type="time"
              required
              value={draft.workdayEnd}
              onChange={(event) => patch({ workdayEnd: event.target.value })}
            />
          )}
        </Field>
        <Field label="Intervalo da grade">
          {(props) => (
            <Select
              {...props}
              value={draft.slotIntervalMinutes}
              onChange={(event) => patch({ slotIntervalMinutes: Number(event.target.value) })}
            >
              {AGENDA_SLOT_INTERVALS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutos
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Modalidade padrao">
          {(props) => (
            <Select
              {...props}
              value={draft.defaultModality}
              onChange={(event) => patch({ defaultModality: event.target.value as ServiceModality })}
            >
              {profession.modalities.map((modality) => (
                <option key={modality} value={modality}>
                  {MODALITY_LABELS[modality]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {defaults}

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="sm" disabled={saving}>
        {saving ? "Salvando..." : doneLabel}
      </Button>
    </form>
  );
}
