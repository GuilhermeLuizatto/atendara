"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FormActions,
  Input,
  Select,
  Textarea,
} from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { APPOINTMENT_STATUS_LABELS, MODALITY_LABELS } from "@/config/labels";
import { validateDeposit } from "@/lib/agenda/deposit";
import { validateHomeVisit } from "@/lib/agenda/home-visit";
import {
  appointmentDefaultsFor,
  bookableServices,
} from "@/lib/agenda/services";
import { fromDateAndTime, toDateKey, toTimeValue } from "@/lib/utils/datetime";
import { byGender, indefiniteTerm, newTerm } from "@/lib/utils/terms";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { AppointmentInput } from "@/services";
import type { Appointment, AppointmentStatus, ServiceModality } from "@/types";

interface Draft {
  clientId: string;
  professionalId: string;
  /** Vazio = sem servico do catalogo. A profissao pode nem ter catalogo. */
  serviceId: string;
  date: string;
  time: string;
  // Texto, como o valor: a profissao pode nao ter duracao padrao, e o campo
  // precisa abrir vazio em vez de mostrar zero.
  durationMinutes: string;
  modality: ServiceModality;
  status: AppointmentStatus;
  priceInReais: string;
  /** Sinal antecipado (E2.2). Vazio = nao pediu sinal. */
  depositInReais: string;
  /** Atendimento a domicilio (E2.3). So em modalidade HOME_VISIT. */
  visitAddress: string;
  travelFeeInReais: string;
  administrativeNotes: string;
}

type Errors = Partial<Record<keyof Draft, string>>;

const EDITABLE_STATUSES: AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "COMPLETED",
  "NO_SHOW",
];

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Vazio vira `null`: nao digitar nada e o mesmo que nao pedir sinal. */
function toCents(value: string): number | null {
  const texto = value.trim();
  if (!texto) return null;
  return Math.round(Number(texto.replace(",", ".")) * 100);
}

function validate(draft: Draft): Errors {
  const errors: Errors = {};

  if (!draft.clientId) errors.clientId = "Selecione quem será atendido.";
  if (!draft.professionalId)
    errors.professionalId = "Selecione o profissional.";
  if (!draft.date) errors.date = "Informe a data.";
  if (!draft.time) errors.time = "Informe o horário.";
  const duration = Number(draft.durationMinutes);
  if (
    !draft.durationMinutes.trim() ||
    !Number.isFinite(duration) ||
    duration < 5
  ) {
    errors.durationMinutes = "Duração mínima de 5 minutos.";
  }

  const price = Number(draft.priceInReais.replace(",", "."));
  if (!Number.isFinite(price) || price < 0) {
    errors.priceInReais = "Valor inválido.";
  }

  // O sinal passa pela mesma regra do repositorio: a tela so adianta a
  // resposta, nao inventa uma propria.
  const deposit = toCents(draft.depositInReais);
  if (deposit !== null && !Number.isFinite(deposit)) {
    errors.depositInReais = "Sinal inválido.";
  } else {
    const validation = validateDeposit({
      depositInCents: deposit,
      priceInCents: Math.round(price * 100),
      available: true,
    });
    if (!validation.ok) errors.depositInReais = validation.error;
  }

  // Endereco e taxa passam pela mesma regra do repositorio.
  const visita = validateHomeVisit({
    modality: draft.modality,
    visitAddress: draft.visitAddress.trim() || null,
    travelFeeInCents: toCents(draft.travelFeeInReais),
    available: true,
  });
  if (!visita.ok) {
    if (draft.visitAddress.trim()) errors.visitAddress = visita.error;
    else errors.travelFeeInReais = visita.error;
  }

  return errors;
}

/**
 * Formulario de atendimento, usado tanto para criar quanto para editar.
 *
 * Data e hora sao dois campos porque e assim que a pessoa pensa ao agendar. A
 * combinacao vira um instante em `fromDateAndTime`, no fuso do produto — o
 * unico lugar do formulario que precisa saber sobre fuso.
 */
export function AppointmentForm({
  open,
  onClose,
  appointment,
  defaultClientId,
  defaultDate,
  defaultTime,
}: {
  open: boolean;
  onClose: () => void;
  appointment?: Appointment | null;
  defaultClientId?: string;
  defaultDate?: string;
  defaultTime?: string;
}) {
  const { profession, terminology, data } = useWorkspace();
  const { createAppointment, updateAppointment } = useWorkspaceActions();

  const clients = data?.clients ?? [];
  const professionals = data?.professionals ?? [];
  // So a profissao com catalogo oferece servico (regra 1: a flag decide).
  // A profissao decide se existe sinal, nunca um `if` por nome (regra 1).
  const deposit = profession.features.depositOnBooking;
  const services = profession.features.serviceCatalog
    ? bookableServices(data?.services ?? [])
    : [];

  const [draft, setDraft] = useState<Draft>(() =>
    appointment
      ? {
          clientId: appointment.clientId,
          professionalId: appointment.professionalId,
          serviceId: appointment.serviceId ?? "",
          date: toDateKey(new Date(appointment.startsAt)),
          time: toTimeValue(appointment.startsAt),
          durationMinutes: String(appointment.durationMinutes),
          modality: appointment.modality,
          status: appointment.status,
          priceInReais: centsToInput(appointment.priceInCents),
          depositInReais:
            appointment.depositInCents === null
              ? ""
              : centsToInput(appointment.depositInCents),
          visitAddress: appointment.visitAddress ?? "",
          travelFeeInReais:
            appointment.travelFeeInCents === null
              ? ""
              : centsToInput(appointment.travelFeeInCents),
          administrativeNotes: appointment.administrativeNotes ?? "",
        }
      : {
          clientId: defaultClientId ?? clients[0]?.id ?? "",
          professionalId: professionals[0]?.id ?? "",
          serviceId: "",
          date: defaultDate ?? toDateKey(new Date()),
          time: defaultTime ?? "09:00",
          durationMinutes:
            profession.defaultAppointmentDurationMinutes === null
              ? ""
              : String(profession.defaultAppointmentDurationMinutes),
          modality: profession.modalities[0],
          status: "SCHEDULED",
          priceInReais:
            profession.defaultPriceInCents === null
              ? ""
              : centsToInput(profession.defaultPriceInCents),
          // Sinal abre vazio sempre: quem pede sinal e ela, atendimento a
          // atendimento.
          depositInReais: "",
          visitAddress: "",
          travelFeeInReais: "",
          administrativeNotes: "",
        },
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  // Endereco so aparece em domicilio: dado pessoal nao se pede por via das
  // duvidas, e atendimento presencial nao tem endereco de cliente.
  const homeVisit =
    profession.features.homeVisitDetails && draft.modality === "HOME_VISIT";

  const patch = (changes: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  /**
   * Escolher um servico **preenche**, nao trava: duracao e valor continuam
   * editaveis naquele atendimento sem mexer no catalogo.
   */
  function chooseService(serviceId: string) {
    const defaults = appointmentDefaultsFor(
      services.find((service) => service.id === serviceId) ?? null,
    );
    patch({
      serviceId,
      ...(defaults.durationMinutes !== null
        ? { durationMinutes: String(defaults.durationMinutes) }
        : {}),
      ...(defaults.priceInCents !== null
        ? { priceInReais: centsToInput(defaults.priceInCents) }
        : {}),
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input: AppointmentInput = {
      clientId: draft.clientId,
      professionalId: draft.professionalId,
      startsAt: fromDateAndTime(draft.date, draft.time),
      durationMinutes: Number(draft.durationMinutes),
      serviceId: draft.serviceId || null,
      // O nome vai junto: renomear o servico depois nao reescreve o passado.
      serviceName:
        services.find((service) => service.id === draft.serviceId)?.name ??
        null,
      modality: draft.modality,
      status: draft.status,
      priceInCents: Math.round(
        Number(draft.priceInReais.replace(",", ".")) * 100,
      ),
      ...(deposit ? { depositInCents: toCents(draft.depositInReais) } : {}),
      ...(homeVisit
        ? {
            visitAddress: draft.visitAddress.trim() || null,
            travelFeeInCents: toCents(draft.travelFeeInReais),
          }
        : {}),
      administrativeNotes: draft.administrativeNotes.trim() || null,
    };

    setSaving(true);
    const result = appointment
      ? await updateAppointment(appointment.id, input)
      : await createAppointment(input);
    setSaving(false);

    // Conflito de horario devolve `null`: o formulario fica aberto para o
    // usuario escolher outro horario sem redigitar o resto.
    if (result !== null) onClose();
  }

  const term = terminology.appointment.singularLower;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={appointment ? `Editar ${term}` : newTerm(terminology.appointment)}
      description={
        clients.length === 0
          ? `Cadastre ${indefiniteTerm(terminology.client)} antes de agendar.`
          : undefined
      }
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {clients.length === 0 ? (
          <p className="bg-warning-soft text-warning-soft-foreground rounded-lg px-3 py-2 text-sm">
            O agendamento é feito para {indefiniteTerm(terminology.client)} já{" "}
            {byGender(terminology.client, "cadastrado", "cadastrada")}.{" "}
            <Link
              href="/clientes"
              onClick={onClose}
              className="font-medium underline underline-offset-2"
            >
              Cadastrar {terminology.client.singularLower}
            </Link>
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label={terminology.client.singular}
              required
              error={errors.clientId}
            >
              {(props) => (
                <Select
                  {...props}
                  value={draft.clientId}
                  onChange={(event) => patch({ clientId: event.target.value })}
                  invalid={Boolean(errors.clientId)}
                >
                  <option value="">Selecione</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.fullName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {services.length > 0 ? (
            <div className="sm:col-span-2">
              <Field
                label="Serviço"
                hint="Preenche a duração e o valor. Você pode mudar os dois aqui."
              >
                {(props) => (
                  <Select
                    {...props}
                    value={draft.serviceId}
                    onChange={(event) => chooseService(event.target.value)}
                  >
                    <option value="">Sem serviço do catálogo</option>
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          ) : null}

          <Field label="Data" required error={errors.date}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={draft.date}
                onChange={(event) => patch({ date: event.target.value })}
                invalid={Boolean(errors.date)}
              />
            )}
          </Field>

          <Field label="Horário" required error={errors.time}>
            {(props) => (
              <Input
                {...props}
                type="time"
                step={300}
                value={draft.time}
                onChange={(event) => patch({ time: event.target.value })}
                invalid={Boolean(errors.time)}
              />
            )}
          </Field>

          <Field
            label="Duração (minutos)"
            required
            error={errors.durationMinutes}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={5}
                step={5}
                value={draft.durationMinutes}
                onChange={(event) =>
                  patch({ durationMinutes: event.target.value })
                }
                invalid={Boolean(errors.durationMinutes)}
              />
            )}
          </Field>

          <Field label="Valor (R$)" error={errors.priceInReais}>
            {(props) => (
              <Input
                {...props}
                type="text"
                inputMode="decimal"
                value={draft.priceInReais}
                onChange={(event) =>
                  patch({ priceInReais: event.target.value })
                }
                invalid={Boolean(errors.priceInReais)}
              />
            )}
          </Field>

          {deposit ? (
            <Field
              label="Sinal (R$)"
              hint="Abate do valor: o resto fica a pagar no atendimento."
              error={errors.depositInReais}
            >
              {(props) => (
                <Input
                  {...props}
                  type="text"
                  inputMode="decimal"
                  value={draft.depositInReais}
                  onChange={(event) =>
                    patch({ depositInReais: event.target.value })
                  }
                  invalid={Boolean(errors.depositInReais)}
                />
              )}
            </Field>
          ) : null}

          {homeVisit ? (
            <div className="sm:col-span-2">
              <Field
                label="Endereço do atendimento"
                hint="Fica só aqui dentro. Nunca vai na mensagem para a cliente."
                error={errors.visitAddress}
              >
                {(props) => (
                  <Input
                    {...props}
                    type="text"
                    value={draft.visitAddress}
                    maxLength={200}
                    onChange={(event) =>
                      patch({ visitAddress: event.target.value })
                    }
                    invalid={Boolean(errors.visitAddress)}
                  />
                )}
              </Field>
            </div>
          ) : null}

          {homeVisit ? (
            <Field
              label="Taxa de deslocamento (R$)"
              hint="Entra como lançamento separado no financeiro."
              error={errors.travelFeeInReais}
            >
              {(props) => (
                <Input
                  {...props}
                  type="text"
                  inputMode="decimal"
                  value={draft.travelFeeInReais}
                  onChange={(event) =>
                    patch({ travelFeeInReais: event.target.value })
                  }
                  invalid={Boolean(errors.travelFeeInReais)}
                />
              )}
            </Field>
          ) : null}

          <Field label="Modalidade">
            {(props) => (
              <Select
                {...props}
                value={draft.modality}
                onChange={(event) =>
                  patch({ modality: event.target.value as ServiceModality })
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

          <Field label="Situação">
            {(props) => (
              <Select
                {...props}
                value={draft.status}
                onChange={(event) =>
                  patch({ status: event.target.value as AppointmentStatus })
                }
              >
                {EDITABLE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {APPOINTMENT_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="sm:col-span-2">
            <Field
              label={terminology.professional.singular}
              required
              error={errors.professionalId}
            >
              {(props) => (
                <Select
                  {...props}
                  value={draft.professionalId}
                  onChange={(event) =>
                    patch({ professionalId: event.target.value })
                  }
                  invalid={Boolean(errors.professionalId)}
                >
                  <option value="">Selecione</option>
                  {professionals.map((professional) => (
                    <option key={professional.id} value={professional.id}>
                      {professional.displayName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="Observação administrativa"
              hint="Visível para a equipe. Não registre informação sensível."
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={draft.administrativeNotes}
                  onChange={(event) =>
                    patch({ administrativeNotes: event.target.value })
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
          <Button
            type="submit"
            size="sm"
            disabled={saving || clients.length === 0}
          >
            {saving ? "Salvando..." : appointment ? "Salvar" : "Agendar"}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
