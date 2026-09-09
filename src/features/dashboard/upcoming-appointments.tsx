"use client";

import Link from "next/link";
import { CalendarRange, Check } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { APPOINTMENT_STATUS_TONE } from "@/components/ui/tones";
import { APPOINTMENT_STATUS_LABELS, MODALITY_LABELS } from "@/config/labels";
import { formatTime, formatTimeUntil } from "@/lib/utils/format";
import { toDateKey } from "@/mocks";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import type { Appointment } from "@/types";

export function UpcomingAppointments({
  appointments,
  now,
  appointmentPlural,
}: {
  appointments: Appointment[];
  now: Date;
  appointmentPlural: string;
}) {
  const { setAppointmentStatus } = useWorkspaceActions();
  const todayKey = toDateKey(now);

  return (
    <Card>
      <CardHeader>
        <CardTitle
          action={
            <Link
              href="/agenda"
              className="text-primary text-xs font-medium hover:underline"
            >
              Ver agenda
            </Link>
          }
        >
          Proximos {appointmentPlural.toLocaleLowerCase("pt-BR")}
        </CardTitle>
      </CardHeader>

      {appointments.length === 0 ? (
        <EmptyState
          icon={<CalendarRange className="size-5" aria-hidden />}
          title="Nada agendado a frente"
          description="Novos agendamentos aparecem aqui automaticamente."
        />
      ) : (
        <ul className="divide-border divide-y">
          {appointments.map((appointment) => {
            const isToday =
              toDateKey(new Date(appointment.startsAt)) === todayKey;

            return (
              <li
                key={appointment.id}
                className="hover:bg-surface-muted/60 flex items-center gap-3 px-5 py-3 transition-colors"
              >
                {/* Horario a esquerda, alinhado: a leitura da lista e por hora. */}
                <div className="w-14 shrink-0">
                  <p className="text-foreground text-sm font-semibold tabular-nums">
                    {formatTime(appointment.startsAt)}
                  </p>
                  <p className="text-subtle-foreground text-[11px]">
                    {isToday
                      ? `${appointment.durationMinutes} min`
                      : formatTimeUntil(appointment.startsAt, now)}
                  </p>
                </div>

                <Avatar name={appointment.clientName} size="sm" />

                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {appointment.clientName}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {MODALITY_LABELS[appointment.modality]} ·{" "}
                    {appointment.professionalName}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    tone={APPOINTMENT_STATUS_TONE[appointment.status]}
                    className="hidden sm:inline-flex"
                  >
                    {APPOINTMENT_STATUS_LABELS[appointment.status]}
                  </Badge>

                  {appointment.status === "SCHEDULED" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        void setAppointmentStatus(appointment.id, "CONFIRMED")
                      }
                      aria-label={`Confirmar atendimento de ${appointment.clientName}`}
                      title="Confirmar"
                    >
                      <Check className="size-4" aria-hidden strokeWidth={2} />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {appointments.length > 0 ? (
        <CardBody className="border-border border-t py-3">
          <Link
            href="/agenda"
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            Ver todos os {appointmentPlural.toLocaleLowerCase("pt-BR")}
          </Link>
        </CardBody>
      ) : null}
    </Card>
  );
}
