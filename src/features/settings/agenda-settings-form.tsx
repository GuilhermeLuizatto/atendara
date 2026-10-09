"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { MODALITY_LABELS, WEEKDAY_LABELS } from "@/config/labels";
import {
  AGENDA_SELF_SERVICE_LIMITS,
  agendaSelfServicePolicyOf,
} from "@/config/agenda-self-service";
import { AGENDA_SLOT_INTERVALS } from "@/config/organization";
import { formatCurrency } from "@/lib/utils/format";
import { byGender } from "@/lib/utils/terms";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { AgendaSettings, ServiceModality } from "@/types";

/**
 * Horario de atendimento da organizacao.
 *
 * Editam OWNER, ADMIN e o titular da organizacao (`agendaSettings:update`): o
 * autonomo precisa mexer no proprio horario diante de um imprevisto. Para os
 * demais membros a tela mostra o horario e diz o que ele muda na pratica, sem
 * oferecer um botao que o servidor recusaria.
 */
export function AgendaSettingsForm({
  onDone,
  doneLabel = "Salvar horário",
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
  const canEdit =
    session?.permissions.includes("agendaSettings:update") ?? false;
  const selfService = agendaSelfServicePolicyOf(draft.selfService);

  const defaultDuration = profession.defaultAppointmentDurationMinutes;
  const defaultPrice = profession.defaultPriceInCents;
  const defaults =
    defaultDuration === null || defaultPrice === null ? (
      <p className="text-muted-foreground text-sm">
        A duração e o valor de cada {terminology.appointment.singularLower} são
        definidos a cada agendamento.
      </p>
    ) : (
      <p className="text-muted-foreground text-sm">
        Cada {terminology.appointment.singularLower}{" "}
        {byGender(terminology.appointment, "novo", "nova")} começa com{" "}
        {defaultDuration} minutos e {formatCurrency(defaultPrice)}. Da para
        mudar os dois em cada agendamento.
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
            <dt className="text-muted-foreground">Horário</dt>
            <dd className="text-foreground">
              {current.workdayStart} às {current.workdayEnd}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Intervalo da grade</dt>
            <dd className="text-foreground">
              {current.slotIntervalMinutes} minutos
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Modalidade padrão</dt>
            <dd className="text-foreground">
              {MODALITY_LABELS[current.defaultModality]}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Agendamento pela Dara</dt>
            <dd className="text-foreground">
              {agendaSelfServicePolicyOf(current.selfService).bookingEnabled
                ? "Permitido"
                : "Desligado"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cancelamento pela Dara</dt>
            <dd className="text-foreground">
              {agendaSelfServicePolicyOf(current.selfService)
                .cancellationEnabled
                ? "Permitido"
                : "Desligado"}
            </dd>
          </div>
        </dl>
        {defaults}
        <p className="text-muted-foreground text-sm">
          Este horário só é alterado pelo titular ou por quem administra a
          organização. Na prática ele não limita nada: a agenda aceita e mostra
          qualquer horário que você marcar, inclusive fora dele.
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
  const patchSelfService = (
    changes: Partial<NonNullable<AgendaSettings["selfService"]>>,
  ) => patch({ selfService: { ...selfService, ...changes } });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (draft.workingDays.length === 0) {
      setError("Escolha ao menos um dia de atendimento.");
      return;
    }
    if (draft.workdayStart >= draft.workdayEnd) {
      setError("O início do expediente precisa ser antes do fim.");
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
        <legend className="text-foreground mb-2 text-xs font-medium">
          Dias de atendimento
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {WEEKDAY_LABELS.map((label, day) => (
            <label
              key={label}
              className="text-foreground flex min-h-6 items-center gap-2 text-sm"
            >
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
        <Field label="Início do expediente">
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
              onChange={(event) =>
                patch({ slotIntervalMinutes: Number(event.target.value) })
              }
            >
              {AGENDA_SLOT_INTERVALS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutos
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Modalidade padrão">
          {(props) => (
            <Select
              {...props}
              value={draft.defaultModality}
              onChange={(event) =>
                patch({
                  defaultModality: event.target.value as ServiceModality,
                })
              }
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

      <fieldset className="border-border space-y-3 rounded-lg border p-4">
        <legend className="text-foreground px-1 text-sm font-medium">
          Autoatendimento pela Dara
        </legend>
        <p className="text-muted-foreground text-sm">
          Estas autorizações mudam a agenda. As respostas continuam dependendo
          das regras de aviso, do WhatsApp comprovado e do consentimento da
          pessoa.
        </p>
        <label className="text-foreground flex min-h-6 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={selfService.bookingEnabled}
            onChange={(event) =>
              patchSelfService({ bookingEnabled: event.target.checked })
            }
          />
          Permitir que a Dara ofereça e confirme horários livres
        </label>
        <label className="text-foreground flex min-h-6 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={selfService.cancellationEnabled}
            onChange={(event) =>
              patchSelfService({ cancellationEnabled: event.target.checked })
            }
          />
          Permitir que a Dara cancele o próximo atendimento
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Antecedência para cancelar">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={
                  AGENDA_SELF_SERVICE_LIMITS.minimumCancellationNoticeHours.min
                }
                max={
                  AGENDA_SELF_SERVICE_LIMITS.minimumCancellationNoticeHours.max
                }
                value={selfService.minimumCancellationNoticeHours}
                onChange={(event) =>
                  patchSelfService({
                    minimumCancellationNoticeHours: Number(event.target.value),
                  })
                }
              />
            )}
          </Field>
          <Field label="Horários por oferta">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={AGENDA_SELF_SERVICE_LIMITS.offeredSlots.min}
                max={AGENDA_SELF_SERVICE_LIMITS.offeredSlots.max}
                value={selfService.offeredSlots}
                onChange={(event) =>
                  patchSelfService({ offeredSlots: Number(event.target.value) })
                }
              />
            )}
          </Field>
          <Field label="Janela de busca (dias)">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={AGENDA_SELF_SERVICE_LIMITS.searchWindowDays.min}
                max={AGENDA_SELF_SERVICE_LIMITS.searchWindowDays.max}
                value={selfService.searchWindowDays}
                onChange={(event) =>
                  patchSelfService({
                    searchWindowDays: Number(event.target.value),
                  })
                }
              />
            )}
          </Field>
        </div>
      </fieldset>

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
