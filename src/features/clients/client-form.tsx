"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import {
  ACQUISITION_CHANNEL_LABELS,
  CLIENT_STATUS_LABELS,
  MODALITY_LABELS,
} from "@/config/labels";
import type { ClientInput } from "@/services";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import { CHANNEL_META } from "@/config/notifications";
import type {
  AcquisitionChannel,
  Client,
  ClientStatus,
  OutboundChannel,
  ServiceModality,
} from "@/types";

type Errors = Partial<Record<keyof ClientInput, string>>;

function emptyDraft(
  modality: ServiceModality,
  professionalId: string | null,
): ClientInput {
  return {
    fullName: "",
    preferredName: null,
    email: null,
    phone: null,
    status: "LEAD",
    preferredModality: modality,
    assignedProfessionalId: professionalId,
    acquisitionChannel: "REFERRAL",
    tags: [],
    administrativeNotes: null,
    appointmentNotificationsEnabled: false,
    notificationConsent: null,
  };
}

function toDraft(client: Client): ClientInput {
  return {
    fullName: client.fullName,
    preferredName: client.preferredName,
    email: client.email,
    phone: client.phone,
    status: client.status,
    preferredModality: client.preferredModality,
    assignedProfessionalId: client.assignedProfessionalId,
    acquisitionChannel: client.acquisitionChannel,
    tags: client.tags,
    administrativeNotes: client.administrativeNotes,
    appointmentNotificationsEnabled: client.appointmentNotificationsEnabled ?? false,
    notificationConsent: client.notificationConsent ?? null,
  };
}

/**
 * Retirar o aceite nao apaga o consentimento: carimba a revogacao. Apagar
 * perderia a prova de que houve consentimento — e de quando ele acabou.
 */
function toggleConsent(draft: ClientInput, enabled: boolean): Partial<ClientInput> {
  const now = new Date().toISOString();
  const current = draft.notificationConsent ?? null;

  if (!enabled) {
    return {
      appointmentNotificationsEnabled: false,
      notificationConsent: current
        ? { ...current, revokedAt: current.revokedAt ?? now }
        : null,
    };
  }

  return {
    appointmentNotificationsEnabled: true,
    notificationConsent: current
      ? { ...current, revokedAt: null }
      : { channels: [], grantedAt: now, revokedAt: null, source: "CLIENT_FORM" },
  };
}

function toggleChannel(
  draft: ClientInput,
  channel: OutboundChannel,
  consented: boolean,
): Partial<ClientInput> {
  const now = new Date().toISOString();
  const current = draft.notificationConsent ?? {
    channels: [],
    grantedAt: now,
    revokedAt: null,
    source: "CLIENT_FORM" as const,
  };
  const channels = consented
    ? [...current.channels.filter((item) => item !== channel), channel]
    : current.channels.filter((item) => item !== channel);

  return { notificationConsent: { ...current, channels, revokedAt: null } };
}

function validate(draft: ClientInput): Errors {
  const errors: Errors = {};

  if (draft.fullName.trim().length < 3) {
    errors.fullName = "Informe o nome completo.";
  }
  if (draft.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email)) {
    errors.email = "E-mail invalido.";
  }
  if (draft.phone && draft.phone.replace(/\D/g, "").length < 10) {
    errors.phone = "Telefone incompleto.";
  }

  return errors;
}

/**
 * Formulario de cadastro.
 *
 * Os rotulos vem da terminologia da profissao ativa, entao o mesmo componente
 * cria "Paciente", "Aluno" ou "Cliente" sem nenhuma condicional de profissao.
 */
export function ClientForm({
  open,
  onClose,
  client,
}: {
  open: boolean;
  onClose: () => void;
  client?: Client | null;
}) {
  const { profession, terminology, data } = useWorkspace();
  const { createClient, updateClient } = useWorkspaceActions();

  const professionals = data?.professionals ?? [];
  const [draft, setDraft] = useState<ClientInput>(() =>
    client
      ? toDraft(client)
      : emptyDraft(profession.modalities[0], professionals[0]?.id ?? null),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const patch = (changes: Partial<ClientInput>) =>
    setDraft((current) => ({ ...current, ...changes }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    const result = client
      ? await updateClient(client.id, draft)
      : await createClient(draft);
    setSaving(false);

    // `null` significa que o repositorio recusou; mantemos o formulario aberto
    // para o usuario corrigir sem reescrever tudo.
    if (result !== null) onClose();
  }

  const term = terminology.client.singularLower;

  // Os canais oferecidos vem da profissao: o grau de sensibilidade dos dados
  // decide o que pode circular por canal aberto.
  const allowedChannels = profession.notifications.allowedChannels;
  const consentedChannels = draft.notificationConsent?.channels ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? `Editar ${term}` : `Novo ${term}`}
      description={
        client
          ? "Dados administrativos. Informacoes sensiveis nao pertencem a este cadastro."
          : `Cadastro administrativo de ${term}.`
      }
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-surface-muted space-y-2 rounded-lg p-3">
          <label className="text-foreground flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.appointmentNotificationsEnabled ?? false}
              onChange={(event) => patch(toggleConsent(draft, event.target.checked))}
            />
            Autoriza receber avisos sobre atendimentos
          </label>

          {draft.appointmentNotificationsEnabled ? (
            <div className="space-y-1 pl-6">
              <p className="text-muted-foreground text-xs">
                Por quais canais. O consentimento vale por canal: marcar aqui nao
                autoriza os demais.
              </p>
              {allowedChannels.map((channel) => (
                <label
                  key={channel}
                  className="text-foreground flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={consentedChannels.includes(channel)}
                    onChange={(event) =>
                      patch(toggleChannel(draft, channel, event.target.checked))
                    }
                  />
                  {CHANNEL_META[channel].label}
                  <span className="text-muted-foreground text-xs">
                    {CHANNEL_META[channel].contactField === "email"
                      ? "exige e-mail no cadastro"
                      : "exige telefone no cadastro"}
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          <p className="text-muted-foreground text-xs">
            Nenhuma mensagem sai enquanto a organizacao nao configurar canal,
            evento, antecedencia e modelo em Configuracoes. Confirmar na agenda,
            por si so, nao envia nada.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Nome completo" required error={errors.fullName}>
              {(props) => (
                <Input
                  {...props}
                  value={draft.fullName}
                  onChange={(event) => patch({ fullName: event.target.value })}
                  placeholder="Nome e sobrenome"
                  invalid={Boolean(errors.fullName)}
                  autoComplete="off"
                />
              )}
            </Field>
          </div>

          <Field label="Como prefere ser chamado" hint="Opcional">
            {(props) => (
              <Input
                {...props}
                value={draft.preferredName ?? ""}
                onChange={(event) =>
                  patch({ preferredName: event.target.value || null })
                }
                autoComplete="off"
              />
            )}
          </Field>

          <Field label="Telefone" error={errors.phone}>
            {(props) => (
              <Input
                {...props}
                value={draft.phone ?? ""}
                onChange={(event) => patch({ phone: event.target.value || null })}
                placeholder="11999999999"
                inputMode="tel"
                invalid={Boolean(errors.phone)}
              />
            )}
          </Field>

          <div className="sm:col-span-2">
            <Field label="E-mail" error={errors.email}>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  value={draft.email ?? ""}
                  onChange={(event) =>
                    patch({ email: event.target.value || null })
                  }
                  placeholder="nome@exemplo.com"
                  invalid={Boolean(errors.email)}
                />
              )}
            </Field>
          </div>

          <Field label="Situacao">
            {(props) => (
              <Select
                {...props}
                value={draft.status}
                onChange={(event) =>
                  patch({ status: event.target.value as ClientStatus })
                }
              >
                {Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Modalidade preferida">
            {(props) => (
              <Select
                {...props}
                value={draft.preferredModality}
                onChange={(event) =>
                  patch({
                    preferredModality: event.target.value as ServiceModality,
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

          <Field label={terminology.professional.singular}>
            {(props) => (
              <Select
                {...props}
                value={draft.assignedProfessionalId ?? ""}
                onChange={(event) =>
                  patch({ assignedProfessionalId: event.target.value || null })
                }
              >
                <option value="">Sem responsavel</option>
                {professionals.map((professional) => (
                  <option key={professional.id} value={professional.id}>
                    {professional.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Como conheceu">
            {(props) => (
              <Select
                {...props}
                value={draft.acquisitionChannel}
                onChange={(event) =>
                  patch({
                    acquisitionChannel: event.target
                      .value as AcquisitionChannel,
                  })
                }
              >
                {Object.entries(ACQUISITION_CHANNEL_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </Select>
            )}
          </Field>

          <div className="sm:col-span-2">
            <Field
              label="Observacoes administrativas"
              hint="Preferencia de horario, forma de pagamento, acesso. Nao registre informacao sensivel aqui."
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={draft.administrativeNotes ?? ""}
                  onChange={(event) =>
                    patch({ administrativeNotes: event.target.value || null })
                  }
                />
              )}
            </Field>
          </div>
        </div>

        <FormActions>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Salvando..." : client ? "Salvar" : "Criar cadastro"}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
