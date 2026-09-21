"use client";

import { Check, CircleSlash, Pencil, UserRound, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { APPOINTMENT_STATUS_TONE } from "@/components/ui/tones";
import { APPOINTMENT_STATUS_LABELS, MODALITY_LABELS } from "@/config/labels";
import { partOf } from "@/lib/agenda/charges";
import { asksAboutDeposit } from "@/lib/agenda/deposit";
import { dayLabel, toDateKey } from "@/lib/utils/datetime";
import { formatCurrency, formatPhone, formatTime } from "@/lib/utils/format";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { Appointment } from "@/types";

import { CancelAppointmentDialog } from "./cancel-appointment-dialog";

export function AppointmentDrawer({
  appointment,
  onClose,
  onEdit,
}: {
  appointment: Appointment | null;
  onClose: () => void;
  onEdit: (appointment: Appointment) => void;
}) {
  const { data, terminology, session } = useWorkspace();
  const { setAppointmentStatus, updateTransaction } = useWorkspaceActions();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (!appointment) return null;

  const client = data?.clients.find((item) => item.id === appointment.clientId);
  // Um atendimento tem ate dois lancamentos desde a E2.2: o que fica a pagar e
  // o sinal. Procurar so por `appointmentId` acharia qualquer um dos dois.
  const ligados = (data?.transactions ?? []).filter(
    (transaction) => transaction.appointmentId === appointment.id,
  );
  const linkedTransaction = ligados.find(
    (transaction) => partOf(transaction) === "SERVICE",
  );
  const depositTransaction = ligados.find(
    (transaction) => partOf(transaction) === "DEPOSIT",
  );
  const depositPaid = depositTransaction?.status === "PAID";
  const podeReceberSinal =
    depositTransaction !== undefined &&
    (depositTransaction.status === "PENDING" ||
      depositTransaction.status === "OVERDUE") &&
    (session?.permissions.includes("transaction:update") ?? false);

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
              label="Horário"
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
            {appointment.travelFeeInCents !== null ? (
              <Row
                label="Deslocamento"
                value={formatCurrency(appointment.travelFeeInCents)}
              />
            ) : null}
            {appointment.visitAddress ? (
              <Row label="Endereço" value={appointment.visitAddress} />
            ) : null}
            {appointment.depositInCents !== null ? (
              <Row
                label="Sinal"
                value={`${formatCurrency(appointment.depositInCents)} · ${depositLabel(
                  depositTransaction?.status ?? null,
                  appointment.depositOutcome,
                )}`}
                action={
                  // O financeiro ainda nao tem lista com "marcar como pago"
                  // (Fase 2). Sem isto, o sinal ficaria eternamente a receber
                  // e o cancelamento nunca teria o que reter ou devolver.
                  podeReceberSinal ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void updateTransaction(depositTransaction!.id, {
                          status: "PAID",
                        })
                      }
                    >
                      Recebi
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            {linkedTransaction ? (
              <Row
                label="Cobrança"
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
                Observação administrativa
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

      <CancelAppointmentDialog
        open={confirmingCancel}
        clientName={appointment.clientName}
        depositInCents={
          asksAboutDeposit({
            status: "CANCELLED",
            hasDeposit: appointment.depositInCents !== null,
            depositPaid,
          })
            ? appointment.depositInCents
            : null
        }
        onClose={() => setConfirmingCancel(false)}
        onConfirm={(choice) => {
          void setAppointmentStatus(appointment.id, "CANCELLED", undefined, {
            deposit: choice,
          }).then(() => onClose());
        }}
      />
    </>
  );
}

/** O que dizer do sinal: o que ja foi decidido vence o estado da cobranca. */
function depositLabel(
  status: string | null,
  outcome: Appointment["depositOutcome"],
): string {
  if (outcome === "KEPT") return "retido";
  if (outcome === "REFUNDED") return "devolvido";
  if (status === "PAID") return "pago";
  if (status === "CANCELLED") return "cancelado";
  if (status === "OVERDUE") return "em atraso";
  return "a receber";
}

function Row({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground flex items-baseline gap-2 text-sm tabular-nums">
        {value}
        {action}
      </dd>
    </div>
  );
}
