"use client";

import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import {
  APPOINTMENT_STATUS_TONE,
  CLIENT_STATUS_TONE,
} from "@/components/ui/tones";
import {
  ACQUISITION_CHANNEL_LABELS,
  APPOINTMENT_STATUS_LABELS,
  CLIENT_STATUS_LABELS,
  MODALITY_LABELS,
} from "@/config/labels";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhone,
} from "@/lib/utils/format";
import { byGender, newTerm, noTerm } from "@/lib/utils/terms";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { Client } from "@/types";

const HISTORY_LIMIT = 6;

export function ClientDrawer({
  client,
  onClose,
  onEdit,
  onNewAppointment,
}: {
  client: Client | null;
  onClose: () => void;
  onEdit: (client: Client) => void;
  onNewAppointment: (client: Client) => void;
}) {
  const { data, terminology } = useWorkspace();
  const { deleteClient } = useWorkspaceActions();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const history = useMemo(() => {
    if (!client || !data) return [];
    return data.appointments
      .filter((appointment) => appointment.clientId === client.id)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, HISTORY_LIMIT);
  }, [client, data]);

  if (!client) return null;

  const professional = data?.professionals.find(
    (item) => item.id === client.assignedProfessionalId,
  );

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={client.fullName}
        subtitle={`${terminology.client.singular} · ${CLIENT_STATUS_LABELS[client.status]}`}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onNewAppointment(client)}>
              <CalendarPlus className="size-3.5" aria-hidden strokeWidth={1.75} />
              {newTerm(terminology.appointment)}
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEdit(client)}>
              <Pencil className="size-3.5" aria-hidden strokeWidth={1.75} />
              Editar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
              className="text-danger-soft-foreground ml-auto"
            >
              <Trash2 className="size-3.5" aria-hidden strokeWidth={1.75} />
              Excluir
            </Button>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Avatar name={client.fullName} size="lg" tone="accent" />
            <div className="min-w-0">
              <p className="text-foreground truncate text-base font-semibold">
                {client.fullName}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={CLIENT_STATUS_TONE[client.status]}>
                  {CLIENT_STATUS_LABELS[client.status]}
                </Badge>
                <Badge tone="neutral">
                  {MODALITY_LABELS[client.preferredModality]}
                </Badge>
                {client.tags.map((tag) => (
                  <Badge key={tag} tone="neutral">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <Section title="Resumo">
            <div className="grid grid-cols-2 gap-3">
              <Metric
                label={`${terminology.appointment.plural} realizados`}
                value={String(client.totalAppointments)}
              />
              <Metric
                label="Em aberto"
                value={formatCurrency(client.outstandingBalanceInCents)}
                tone={client.outstandingBalanceInCents > 0 ? "warning" : "default"}
              />
              <Metric
                label="Ultimo"
                value={
                  client.lastAppointmentAt
                    ? formatDate(client.lastAppointmentAt)
                    : "—"
                }
              />
              <Metric
                label="Proximo"
                value={
                  client.nextAppointmentAt
                    ? formatDate(client.nextAppointmentAt)
                    : "—"
                }
              />
            </div>
          </Section>

          <Section title="Contato">
            <dl className="space-y-2.5">
              <Row label="Telefone" value={formatPhone(client.phone) || "—"} />
              <Row label="E-mail" value={client.email ?? "—"} />
              <Row
                label={terminology.professional.singular}
                value={professional?.displayName ?? "Sem responsavel"}
              />
              <Row
                label="Como conheceu"
                value={ACQUISITION_CHANNEL_LABELS[client.acquisitionChannel]}
              />
            </dl>
          </Section>

          <Section title="Observacoes administrativas">
            <p className="text-muted-foreground text-sm leading-relaxed">
              {client.administrativeNotes ?? "Nenhuma observacao registrada."}
            </p>
          </Section>

          <Section title={`Historico de ${terminology.appointment.pluralLower}`}>
            {history.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {noTerm(terminology.appointment)}{" "}
                {byGender(terminology.appointment, "registrado", "registrada")}.
              </p>
            ) : (
              <ul className="divide-border border-border divide-y rounded-lg border">
                {history.map((appointment) => (
                  <li
                    key={appointment.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground text-sm tabular-nums">
                        {formatDateTime(appointment.startsAt)}
                      </p>
                      <p className="text-subtle-foreground text-xs">
                        {MODALITY_LABELS[appointment.modality]} ·{" "}
                        {appointment.professionalName}
                      </p>
                    </div>
                    <Badge tone={APPOINTMENT_STATUS_TONE[appointment.status]}>
                      {APPOINTMENT_STATUS_LABELS[appointment.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => {
          void deleteClient(client.id).then((result) => {
            if (result !== null) onClose();
          });
        }}
        title={`Excluir ${terminology.client.singularLower}`}
        message={`O cadastro de ${client.fullName} sera removido. Atendimentos futuros ou pendencias financeiras impedem a exclusao.`}
        confirmLabel="Excluir"
      />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-subtle-foreground text-[11px] font-medium tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground min-w-0 truncate text-sm">{value}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="border-border rounded-lg border px-3 py-2.5">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p
        className={
          tone === "warning"
            ? "text-warning-soft-foreground mt-0.5 text-sm font-semibold tabular-nums"
            : "text-foreground mt-0.5 text-sm font-semibold tabular-nums"
        }
      >
        {value}
      </p>
    </div>
  );
}
