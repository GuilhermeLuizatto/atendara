"use client";

import { CalendarOff, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/load-more";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils/cn";
import {
  dayLabel,
  dayOfMonth,
  monthLabel,
  shortWeekdayLabel,
  toDateKey,
  weekLabel,
  type DateKey,
} from "@/lib/utils/datetime";
import { formatDate } from "@/lib/utils/format";
import { newTerm } from "@/lib/utils/terms";
import { useNow } from "@/lib/utils/use-now";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";
import type { Appointment } from "@/types";

import { AppointmentDrawer } from "./appointment-drawer";
import { AppointmentForm } from "./appointment-form";
import { visibleHourRange } from "./layout";
import { MonthView } from "./month-view";
import { DayColumn, HourRuler } from "./time-grid";
import { useAgenda, type AgendaMode } from "./use-agenda";

const MODE_OPTIONS: { value: AgendaMode; label: string }[] = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
];

export function AgendaView() {
  const { terminology, loading, data } = useWorkspace();
  const { loadMore } = useWorkspaceActions();
  const agenda = useAgenda();
  const now = useNow();

  // A agenda chega das datas mais distantes para as mais proximas do passado.
  // Olhar um periodo anterior ao mais antigo carregado mostraria dias vazios
  // que talvez nao estejam vazios.
  const page = data?.pagination?.appointments;
  const oldestLoaded = data?.appointments[0]?.startsAt ?? null;
  const beforeLoaded =
    Boolean(page?.hasMore || page?.loading) &&
    oldestLoaded !== null &&
    agenda.visibleDays[0] <= toDateKey(new Date(oldestLoaded));

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [formDefaults, setFormDefaults] = useState<{
    date?: string;
    time?: string;
  }>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A agenda e a fonte da verdade: relemos o registro selecionado a cada render
  // para que confirmar ou cancelar atualize a gaveta sem fecha-la.
  const selected = useMemo(() => {
    if (!selectedId) return null;
    for (const bucket of agenda.byDay.values()) {
      const found = bucket.find((item) => item.id === selectedId);
      if (found) return found;
    }
    return null;
  }, [selectedId, agenda.byDay]);

  const visibleAppointments = useMemo(
    () => agenda.visibleDays.flatMap((key) => agenda.byDay.get(key) ?? []),
    [agenda.visibleDays, agenda.byDay],
  );

  const { startHour, endHour } = useMemo(
    () =>
      visibleHourRange(
        visibleAppointments,
        agenda.settings?.workdayStart ?? "08:00",
        agenda.settings?.workdayEnd ?? "19:00",
      ),
    [visibleAppointments, agenda.settings],
  );

  const openCreate = (date?: string, time?: string) => {
    setEditing(null);
    setFormDefaults({ date, time });
    setFormOpen(true);
  };

  if (loading) return <AgendaSkeleton />;

  const periodLabel =
    agenda.mode === "day"
      ? dayLabel(agenda.cursor)
      : agenda.mode === "week"
        ? weekLabel(agenda.visibleDays)
        : monthLabel(agenda.cursor);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agenda"
        description={`${agenda.visibleCount} ${agenda.visibleCount === 1 ? terminology.appointment.singularLower : terminology.appointment.pluralLower} no período.`}
        actions={
          <Button size="md" onClick={() => openCreate()}>
            <Plus className="size-4" aria-hidden strokeWidth={2} />
            {newTerm(terminology.appointment)}
          </Button>
        }
      />

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={agenda.goPrevious}
              aria-label="Período anterior"
            >
              <ChevronLeft className="size-4" aria-hidden strokeWidth={1.75} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={agenda.goNext}
              aria-label="Próximo período"
            >
              <ChevronRight className="size-4" aria-hidden strokeWidth={1.75} />
            </Button>
            <Button variant="outline" size="sm" onClick={agenda.goToday}>
              Hoje
            </Button>
          </div>

          <p className="text-foreground min-w-0 flex-1 truncate text-sm font-medium first-letter:uppercase">
            {periodLabel}
          </p>

          <Tabs
            options={MODE_OPTIONS}
            value={agenda.mode}
            onChange={agenda.setMode}
          />

          <Select
            value={agenda.professionalId}
            onChange={(event) => agenda.setProfessionalId(event.target.value)}
            aria-label={`Filtrar por ${terminology.professional.singularLower}`}
            className="h-8 w-auto min-w-40 text-xs"
          >
            <option value="ALL">Todos os profissionais</option>
            {agenda.professionals.map((professional) => (
              <option key={professional.id} value={professional.id}>
                {professional.displayName}
              </option>
            ))}
          </Select>

          <label className="text-muted-foreground flex min-h-8 items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={agenda.showCancelled}
              onChange={(event) =>
                agenda.setShowCancelled(event.target.checked)
              }
              className="accent-primary size-4"
            />
            Mostrar cancelados
          </label>
        </div>
      </Card>

      {beforeLoaded && oldestLoaded ? (
        <Card>
          <LoadMore
            page={page}
            summary={`${terminology.appointment.plural} anteriores a ${formatDate(oldestLoaded)} ainda não foram carregados.`}
            label="Carregar período anterior"
            onLoadMore={() => void loadMore("appointments")}
          />
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        {agenda.mode === "month" ? (
          <MonthView
            cursor={agenda.cursor}
            days={agenda.visibleDays}
            byDay={agenda.byDay}
            today={agenda.today}
            onSelectDay={(key) => {
              agenda.setCursor(key);
              agenda.setMode("day");
            }}
            onSelectAppointment={(appointment) => setSelectedId(appointment.id)}
          />
        ) : visibleAppointments.length === 0 && agenda.mode === "day" ? (
          <EmptyState
            icon={<CalendarOff className="size-5" aria-hidden />}
            title="Nenhum atendimento neste dia"
            description="Clique em um horário da grade para agendar."
            action={
              <Button size="sm" onClick={() => openCreate(agenda.cursor)}>
                Agendar
              </Button>
            }
          />
        ) : (
          <div className="scrollbar-slim overflow-x-auto">
            <div className={cn(agenda.mode === "week" && "min-w-[52rem]")}>
              {agenda.mode === "week" ? (
                <div className="border-border flex border-b">
                  <div className="w-12 shrink-0 sm:w-14" />
                  {agenda.visibleDays.map((key) => (
                    <DayHeading
                      key={key}
                      dateKey={key}
                      isToday={key === agenda.today}
                      count={agenda.byDay.get(key)?.length ?? 0}
                    />
                  ))}
                </div>
              ) : null}

              <div className="flex">
                <HourRuler startHour={startHour} endHour={endHour} />
                {agenda.visibleDays.map((key) => (
                  <div
                    key={key}
                    className="border-border flex-1 border-l first:border-l-0"
                  >
                    <DayColumn
                      dateKey={key}
                      appointments={agenda.byDay.get(key) ?? []}
                      startHour={startHour}
                      endHour={endHour}
                      now={now}
                      compact={agenda.mode === "week"}
                      onSelect={(appointment) => setSelectedId(appointment.id)}
                      onCreateAt={(dateKey, time) => openCreate(dateKey, time)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      {formOpen ? (
        <AppointmentForm
          open
          appointment={editing}
          defaultDate={formDefaults.date}
          defaultTime={formDefaults.time}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
            setFormDefaults({});
          }}
        />
      ) : null}

      <AppointmentDrawer
        appointment={selected}
        onClose={() => setSelectedId(null)}
        onEdit={(appointment) => {
          setSelectedId(null);
          setEditing(appointment);
          setFormDefaults({});
          setFormOpen(true);
        }}
      />
    </div>
  );
}

function DayHeading({
  dateKey,
  isToday,
  count,
}: {
  dateKey: DateKey;
  isToday: boolean;
  count: number;
}) {
  return (
    <div className="border-border flex-1 border-l px-2 py-2 text-center first:border-l-0">
      <p className="text-subtle-foreground text-[11px] uppercase">
        {shortWeekdayLabel(dateKey)}
      </p>
      <p
        className={cn(
          "mx-auto mt-0.5 flex size-6 items-center justify-center rounded-full text-sm tabular-nums",
          isToday ? "bg-accent text-accent-foreground font-semibold" : "text-foreground",
        )}
      >
        {dayOfMonth(dateKey)}
      </p>
      <p className="text-subtle-foreground mt-0.5 text-[10px]">
        {count > 0 ? `${count}` : "—"}
      </p>
    </div>
  );
}

function AgendaSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <Skeleton className="rounded-card h-14 w-full" />
      <Skeleton className="rounded-card h-96 w-full" />
    </div>
  );
}
