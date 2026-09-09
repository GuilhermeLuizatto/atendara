"use client";

import Link from "next/link";
import { CalendarCheck, CalendarX2, Check, Clock } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { APPOINTMENT_STATUS_TONE } from "@/components/ui/tones";
import { APPOINTMENT_STATUS_LABELS, MODALITY_LABELS } from "@/config/labels";
import { cn } from "@/lib/utils/cn";
import { formatTime, formatTimeUntil } from "@/lib/utils/format";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import type { Appointment } from "@/types";

/**
 * Cartao de destaque do proximo atendimento.
 *
 * E a informacao mais consultada do dia, entao ganha tratamento visual proprio:
 * fundo com a cor da profissao, horario em tamanho grande e as duas acoes que o
 * profissional realmente executa daqui — confirmar e cancelar.
 */
export function NextAppointment({
  appointment,
  inProgress,
  now,
  appointmentLabel,
  clientLabel,
}: {
  appointment: Appointment | null;
  inProgress: boolean;
  now: Date;
  appointmentLabel: string;
  clientLabel: string;
}) {
  const { setAppointmentStatus } = useWorkspaceActions();

  if (!appointment) {
    return (
      <div className="rounded-card border-border bg-surface shadow-card border">
        <EmptyState
          icon={<CalendarCheck className="size-5" aria-hidden />}
          title={`Nenhum ${appointmentLabel.toLocaleLowerCase("pt-BR")} pela frente`}
          description="Sua agenda esta livre pelo resto do dia. Aproveite para revisar pendencias."
          action={
            <Link href="/agenda">
              <Button variant="secondary" size="sm">
                Abrir agenda
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <section
      aria-label={`Proximo ${appointmentLabel.toLocaleLowerCase("pt-BR")}`}
      className={cn(
        "rounded-card border-border bg-surface shadow-card relative overflow-hidden border",
      )}
    >
      {/* Faixa da cor da profissao: identifica o contexto sem depender de texto. */}
      <span aria-hidden className="bg-accent absolute inset-x-0 top-0 h-1" />

      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <Avatar name={appointment.clientName} size="lg" tone="accent" />

          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-muted-foreground text-xs font-medium">
                {inProgress
                  ? "Em andamento"
                  : `Proximo ${appointmentLabel.toLocaleLowerCase("pt-BR")}`}
              </p>
              <Badge
                tone={inProgress ? "accent" : "neutral"}
                dot={inProgress}
                className="text-[11px]"
              >
                {inProgress
                  ? "agora"
                  : formatTimeUntil(appointment.startsAt, now)}
              </Badge>
            </div>

            <p className="text-foreground truncate text-lg font-semibold">
              {appointment.clientName}
            </p>

            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <span className="text-foreground inline-flex items-center gap-1.5 font-medium tabular-nums">
                <Clock
                  className="text-subtle-foreground size-3.5"
                  aria-hidden
                  strokeWidth={1.75}
                />
                {formatTime(appointment.startsAt)} –{" "}
                {formatTime(appointment.endsAt)}
              </span>
              <span className="text-subtle-foreground">
                {appointment.durationMinutes} min
              </span>
              <Badge tone="neutral">
                {MODALITY_LABELS[appointment.modality]}
              </Badge>
              <Badge tone={APPOINTMENT_STATUS_TONE[appointment.status]}>
                {APPOINTMENT_STATUS_LABELS[appointment.status]}
              </Badge>
            </div>

            <p className="text-subtle-foreground text-xs">
              {clientLabel} de {appointment.professionalName}
            </p>
            <p className="text-subtle-foreground text-xs">Confirmar atualiza somente a agenda. Nenhuma mensagem sera enviada.</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void setAppointmentStatus(appointment.id, "CANCELLED")
            }
          >
            <CalendarX2 className="size-3.5" aria-hidden strokeWidth={1.75} />
            Cancelar
          </Button>
        </div>
      </div>
    </section>
  );
}
