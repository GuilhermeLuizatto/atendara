"use client";

import { Bell, CalendarDays, MessageSquare, Wallet } from "lucide-react";

import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/utils/format";

import type { DashboardModel } from "./use-dashboard";

/**
 * Barra de indicadores do dia.
 *
 * Cada cartao responde a uma pergunta que o profissional faz ao abrir o
 * sistema: quanto tenho pela frente, quem esta esperando, quanto entrou e o
 * que precisa da minha atencao.
 */
export function KpiRow({
  model,
  appointmentPlural,
}: {
  model: DashboardModel;
  appointmentPlural: string;
}) {
  const remaining = model.todayTotal - model.todayCompleted;

  return (
    <section
      aria-label="Indicadores do dia"
      className="grid grid-cols-2 gap-3 xl:grid-cols-4"
    >
      <StatCard
        label={`${appointmentPlural} hoje`}
        value={String(model.todayTotal)}
        hint={
          model.todayTotal === 0
            ? "Agenda livre"
            : `${model.todayCompleted} realizados · ${remaining} restantes`
        }
        icon={CalendarDays}
        tone="accent"
        footer={
          model.todayTotal > 0 ? (
            <DayProgress
              completed={model.todayCompleted}
              total={model.todayTotal}
            />
          ) : null
        }
      />

      <StatCard
        label="Mensagens pendentes"
        value={String(model.waitingConversations.length)}
        hint={
          model.criticalConversations > 0
            ? `${model.criticalConversations} com possivel risco`
            : "Aguardando sua resposta"
        }
        icon={MessageSquare}
        tone={
          model.criticalConversations > 0
            ? "danger"
            : model.waitingConversations.length > 0
              ? "warning"
              : "default"
        }
      />

      <StatCard
        label="Faturamento do mes"
        value={formatCurrency(model.receivedInCents)}
        hint={`${formatCurrency(model.pendingInCents)} a receber`}
        icon={Wallet}
        tone="success"
        footer={
          model.overdueCount > 0 ? (
            <p className="text-danger-soft-foreground text-xs font-medium">
              {formatCurrency(model.overdueInCents)} em atraso (
              {model.overdueCount})
            </p>
          ) : null
        }
      />

      <StatCard
        label="Alertas"
        value={String(model.unreadAlerts)}
        hint={
          model.criticalAlerts > 0
            ? `${model.criticalAlerts} critico(s) aguardando`
            : "Nenhum alerta critico"
        }
        icon={Bell}
        tone={model.criticalAlerts > 0 ? "danger" : "default"}
      />
    </section>
  );
}

function DayProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const percent = Math.round((completed / total) * 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progresso do dia"
      className="bg-surface-muted h-1.5 w-full overflow-hidden rounded-full"
    >
      <div
        className="bg-accent h-full rounded-full transition-[width] duration-500"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
