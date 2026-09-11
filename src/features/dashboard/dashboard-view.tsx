"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "@/providers/workspace-provider";

import { OnboardingPanel } from "@/features/onboarding/onboarding-panel";

import { AgentActivity } from "./agent-activity";
import { AlertsPanel } from "./alerts-panel";
import { DashboardHeader } from "./dashboard-header";
import { KpiRow } from "./kpi-row";
import { NextAppointment } from "./next-appointment";
import { UpcomingAppointments } from "./upcoming-appointments";
import { useDashboard } from "./use-dashboard";
import { WaitingMessages } from "./waiting-messages";

export function DashboardView() {
  const { session, terminology } = useWorkspace();
  const model = useDashboard();

  if (!model) return <DashboardSkeleton />;

  // Quando ha algo critico em aberto, a coluna de alertas sobe para o topo no
  // mobile. Em telas largas as duas colunas ficam visiveis de qualquer forma.
  const alertsFirst = model.criticalAlerts > 0;

  return (
    <div className="space-y-6">
      <DashboardHeader
        now={model.now}
        professionalName={session?.user.displayName ?? "Profissional"}
        appointmentTerm={terminology.appointment}
      />

      <OnboardingPanel />

      <KpiRow
        model={model}
        appointmentPlural={terminology.appointment.plural}
      />

      <NextAppointment
        appointment={model.nextAppointment}
        inProgress={model.nextIsInProgress}
        now={model.now}
        appointmentTerm={terminology.appointment}
        clientLabel={terminology.client.singular}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <UpcomingAppointments
            appointments={model.upcoming}
            now={model.now}
            appointmentTerm={terminology.appointment}
          />
          <WaitingMessages
            conversations={model.waitingConversations}
            now={model.now}
          />
        </div>

        <div
          className={cn(
            "space-y-4",
            alertsFirst && "order-first lg:order-none",
          )}
        >
          <AlertsPanel
            alerts={model.alerts}
            criticalCount={model.criticalAlerts}
            now={model.now}
          />
          <AgentActivity
            decisions={model.recentDecisions}
            autoResponses={model.autoResponses}
            escalations={model.escalations}
            automationRate={model.automationRate}
            now={model.now}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Esqueleto com a mesma geometria da tela final. Reproduzir o layout evita o
 * salto de conteudo quando os dados chegam.
 */
function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p role="status" className="sr-only">
        Carregando o painel...
      </p>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="min-h-28 p-4 sm:min-h-32">
            <div className="flex items-start justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
            <Skeleton className="mt-3 h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-28" />
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex gap-4">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SkeletonList rows={5} />
          <SkeletonList rows={3} />
        </div>
        <div className="space-y-4">
          <SkeletonList rows={3} />
          <SkeletonList rows={4} />
        </div>
      </div>
    </div>
  );
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <Card>
      <div className="border-border border-b px-5 py-4">
        <Skeleton className="h-4 w-36" />
      </div>
      <ul className="divide-border divide-y">
        {Array.from({ length: rows }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 px-5 py-3.5">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
