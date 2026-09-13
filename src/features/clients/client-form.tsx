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
import { newTerm } from "@/lib/utils/terms";
import type {
  AcquisitionChannel,
  Client,
  ClientStatus,
  ServiceModality,
} from "@/types";

import {
  ConsentFields,
  consentFromDraft,
  initialConsentDraft,
  type ConsentDraft,
  type ConsentErrors,
} from "./consent-fields";

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
  };
}

function validate(draft: ClientInput): Errors {
  const errors: Errors = {};

  if (draft.fullName.trim().length < 3) {
    errors.fullName = "Informe o nome completo.";
  }
  if (draft.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email)) {
    errors.email = "E-mail inválido.";
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
  const { profession, terminology, data, session } = useWorkspace();
  const { createClient, updateClient } = useWorkspaceActions();

  const professionals = data?.professionals ?? [];
  const [draft, setDraft] = useState<ClientInput>(() =>
    client
      ? toDraft(client)
      : emptyDraft(profession.modalities[0], professionals[0]?.id ?? null),
  );
  const [consent, setConsent] = useState<ConsentDraft>(() => initialConsentDraft(client));
  const [errors, setErrors] = useState<Errors>({});
  const [consentErrors, setConsentErrors] = useState<ConsentErrors>({});
  const [saving, setSaving] = useState(false);

  const savedConsent = client?.notificationConsent ?? null;
  const canRecordConsent = session?.permissions.includes("notificationConsent:record") ?? false;

  const patch = (changes: Partial<ClientInput>) =>
    setDraft((current) => ({ ...current, ...changes }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const found = validate(draft);
    const built = consentFromDraft(
      savedConsent,
      consent,
      session?.user.userId ?? null,
      new Date().toISOString(),
    );
    setErrors(found);
    setConsentErrors(built.errors);
    if (Object.keys(found).length > 0 || Object.keys(built.errors).length > 0) return;

    const input: ClientInput = {
      ...draft,
      appointmentNotificationsEnabled: consent.enabled,
      notificationConsent: built.consent,
    };

    setSaving(true);
    const result = client
      ? await updateClient(client.id, input)
      : await createClient(input);
    setSaving(false);

    // `null` significa que o repositorio recusou; mantemos o formulario aberto
    // para o usuario corrigir sem reescrever tudo.
    if (result !== null) onClose();
  }

  const term = terminology.client.singularLower;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? `Editar ${term}` : newTerm(terminology.client)}
      description={
        client
          ? "Dados administrativos. Informações sensíveis não pertencem a este cadastro."
          : `Cadastro administrativo de ${term}.`
      }
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Os canais oferecidos vem da profissao: o grau de sensibilidade dos
            dados decide o que pode circular por canal aberto. */}
        <ConsentFields
          organizationName={data?.organization.name ?? ""}
          profession={profession}
          saved={savedConsent}
          draft={consent}
          errors={consentErrors}
          disabled={!canRecordConsent}
          onChange={(changes) => setConsent((current) => ({ ...current, ...changes }))}
        />
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

          <Field label="Situação">
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
                <option value="">Sem responsável</option>
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
              label="Observações administrativas"
              hint="Preferência de horário, forma de pagamento, acesso. Não registre informação sensível aqui."
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
