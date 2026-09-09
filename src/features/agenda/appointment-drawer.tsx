"use client";

import { Check, CircleSlash, Pencil, UserRound, X } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { APPOINTMENT_STATUS_TONE } from "@/components/ui/tones";
import { APPOINTMENT_STATUS_LABELS, MODALITY_LABELS } from "@/config/labels";
import { dayLabel, toDateKey } from "@/lib/utils/datetime";
import { formatCurrency, formatPhone, formatTime } from "@/lib/utils/format";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { Appointment } from "@/types";

export function AppointmentDrawer({
  appointment,
  onClose,
  onEdit,
}: {
  appointment: Appointment | null;
  onClose: () => void;
  onEdit: (appointment: Appointment) => void;
}) {
  const { data, terminology } = useWorkspace();
  const { setAppointmentStatus } = useWorkspaceActions();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (!appointment) return null;

  const client = data?.clients.find(
    (item) => item.id === appointment.clientId,
  );
  const linkedTransaction = data?.transactions.find(
    (transaction) => transaction.appointmentId === appointment.id,
  );

  const isOpen =
    appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED";

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={appointment.clientName}
        subtitle={`${dayLabel(toDateKey(new Date(appointment.startsAt)))} · ${formatTime(appointment.startsAt)}`}
        footer={
          <div className="flex flex-wrap gap-2">
            {appointment.status === "SCHEDULED" ? (
              <Button
                size="sm"
                onClick={() =>
                  void setAppointmentStatus(appointment.id, "CONFIRMED")
                }
              >
                <Check className="size-3.5" aria-hidden strokeWidth={2} />
                Confirmar
              </Button>
            ) : null}

            {isOpen ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void setAppointmentStatus(appointment.id, "COMPLETED")
                }
              >
                Marcar como realizado
              </Button>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(appointment)}
            >
              <Pencil className="size-3.5" aria-hidden strokeWidth={1.75} />
              Editar
            </Button>

            {isOpen ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void setAppointmentStatus(appointment.id, "NO_SHOW")
                  }
                  title="Registrar falta"
                >
                  <CircleSlash
                    className="size-3.5"
                    aria-hidden
                    strokeWidth={1.75}
                  />
                  Falta
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingCancel(true)}
                  className="text-danger-soft-foreground ml-auto"
                >
                  <X className="size-3.5" aria-hidden strokeWidth={1.75} />
                  Cancelar
                </Button>
              </>
            ) : null}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={APPOINTMENT_STATUS_TONE[appointment.status]}>
              {APPOINTMENT_STATUS_LABELS[appointment.status]}
            </Badge>
            <Badge tone="neutral">
              {MODALITY_LABELS[appointment.modality]}
            </Badge>
            {appointment.origin === "AI_AGENT" ? (
              <Badge tone="primary">Agendado pelo agente</Badge>
            ) : null}
          </div>

          <dl className="border-border divide-border divide-y rounded-lg border">
            <Row
              label="Horario"
              value={`${formatTime(appointment.startsAt)} – ${formatTime(appointment.endsAt)} (${appointment.durationMinutes} min)`}
            />
            <Row
              label={terminology.professional.singular}
              value={appointment.professionalName}
            />
            <Row
              label="Valor"
              value={formatCurrency(appointment.priceInCents)}
            />
            {linkedTransaction ? (
              <Row
                label="Cobranca"
                value={
                  linkedTransaction.status === "PAID"
                    ? "Paga"
                    : linkedTransaction.status === "OVERDUE"
                      ? "Em atraso"
                      : linkedTransaction.status === "CANCELLED"
                        ? "Cancelada"
                        : "Pendente"
                }
              />
            ) : null}
          </dl>

          <section className="space-y-2">
            <h3 className="text-subtle-foreground text-[11px] font-medium tracking-wide uppercase">
              {terminology.client.singular}
            </h3>
            <div className="border-border flex items-center gap-3 rounded-lg border px-3 py-2.5">
              <Avatar name={appointment.clientName} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {appointment.clientName}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {formatPhone(client?.phone ?? null) ||
                    client?.email ||
                    "Sem contato"}
                </p>
              </div>
              <UserRound
                className="text-subtle-foreground size-4 shrink-0"
                aria-hidden
                strokeWidth={1.75}
              />
            </div>
          </section>

          {appointment.administrativeNotes ? (
            <section className="space-y-2">
              <h3 className="text-subtle-foreground text-[11px] font-medium tracking-wide uppercase">
                Observacao administrativa
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {appointment.administrativeNotes}
              </p>
            </section>
          ) : null}

          {appointment.cancellationReason ? (
            <section className="space-y-2">
              <h3 className="text-subtle-foreground text-[11px] font-medium tracking-wide uppercase">
                Motivo do cancelamento
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {appointment.cancellationReason}
              </p>
            </section>
          ) : null}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
        onConfirm={() => {
          void setAppointmentStatus(appointment.id, "CANCELLED").then(() =>
            onClose(),
          );
        }}
        title="Cancelar atendimento"
        message={`O atendimento de ${appointment.clientName} sera cancelado e a cobranca pendente vinculada tambem.`}
        confirmLabel="Cancelar atendimento"
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground text-sm tabular-nums">{value}</dd>
    </div>
  );
}
