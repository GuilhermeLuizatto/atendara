"use client";

import { useMemo } from "react";

import { useNow } from "@/lib/utils/use-now";
import { toDateKey } from "@/mocks";
import { useWorkspace } from "@/providers/workspace-provider";
import type {
  AIDecision,
  Appointment,
  AttentionLevel,
  Conversation,
  Notification,
} from "@/types";

const UPCOMING_LIMIT = 5;
const ACTIVITY_LIMIT = 5;
const ALERTS_LIMIT = 4;

const ATTENTION_RANK: Record<AttentionLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  ATTENTION: 2,
  NORMAL: 3,
};

export interface DashboardModel {
  now: Date;

  todayTotal: number;
  todayCompleted: number;
  todayConfirmed: number;
  /** Atendimento em andamento ou o proximo a comecar. */
  nextAppointment: Appointment | null;
  /** `true` quando o horario atual esta dentro do atendimento. */
  nextIsInProgress: boolean;
  upcoming: Appointment[];

  waitingConversations: Conversation[];
  criticalConversations: number;

  receivedInCents: number;
  pendingInCents: number;
  overdueInCents: number;
  overdueCount: number;

  alerts: Notification[];
  unreadAlerts: number;
  criticalAlerts: number;

  recentDecisions: AIDecision[];
  autoResponses: number;
  escalations: number;
  automationRate: number;
}

/**
 * Agrega o conjunto de dados em tudo o que o dashboard precisa exibir.
 *
 * Mantido fora dos componentes de proposito: a derivacao e testavel isolada e,
 * quando os repositorios do Firestore entrarem na Fase 2, o unico ponto que
 * muda e a origem de `data`.
 */
export function useDashboard(): DashboardModel | null {
  const { data } = useWorkspace();
  const now = useNow();

  return useMemo(() => {
    if (!data) return null;

    const nowIso = now.toISOString();
    const todayKey = toDateKey(now);

    const todayAppointments = data.appointments.filter(
      (appointment) =>
        toDateKey(new Date(appointment.startsAt)) === todayKey &&
        appointment.status !== "CANCELLED",
    );

    const active = data.appointments.filter(
      (appointment) =>
        appointment.status === "SCHEDULED" ||
        appointment.status === "CONFIRMED",
    );

    // Um atendimento ja iniciado ainda e "o proximo" — o profissional esta
    // dentro dele agora, e e essa a informacao util no topo da tela.
    const inProgress = active.find(
      (appointment) =>
        appointment.startsAt <= nowIso && appointment.endsAt > nowIso,
    );
    const future = active
      .filter((appointment) => appointment.startsAt > nowIso)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    const nextAppointment = inProgress ?? future[0] ?? null;
    const upcoming = (inProgress ? future : future.slice(1)).slice(
      0,
      UPCOMING_LIMIT,
    );

    const waitingConversations = data.conversations
      .filter((conversation) => conversation.status === "WAITING_PROFESSIONAL")
      .sort(
        (a, b) =>
          ATTENTION_RANK[a.attention] - ATTENTION_RANK[b.attention] ||
          b.lastMessageAt.localeCompare(a.lastMessageAt),
      );

    const monthPrefix = nowIso.slice(0, 7);
    const income = data.transactions.filter(
      (transaction) => transaction.type === "INCOME",
    );

    const receivedInCents = income
      .filter(
        (transaction) =>
          transaction.status === "PAID" &&
          transaction.dueDate.startsWith(monthPrefix),
      )
      .reduce((total, transaction) => total + transaction.amountInCents, 0);

    const pendingInCents = income
      .filter((transaction) => transaction.status === "PENDING")
      .reduce((total, transaction) => total + transaction.amountInCents, 0);

    const overdue = income.filter(
      (transaction) => transaction.status === "OVERDUE",
    );

    const openAlerts = data.notifications
      .filter((notification) => notification.status !== "ACKNOWLEDGED")
      .sort(
        (a, b) =>
          ATTENTION_RANK[a.priority] - ATTENTION_RANK[b.priority] ||
          b.createdAt.localeCompare(a.createdAt),
      );

    const recentDecisions = [...data.decisions]
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
      .slice(0, ACTIVITY_LIMIT);

    const autoResponses = data.decisions.filter(
      (decision) => decision.action === "AUTO_RESPONSE",
    ).length;
    const escalations = data.decisions.length - autoResponses;

    return {
      now,

      todayTotal: todayAppointments.length,
      todayCompleted: todayAppointments.filter(
        (appointment) => appointment.status === "COMPLETED",
      ).length,
      todayConfirmed: todayAppointments.filter(
        (appointment) => appointment.status === "CONFIRMED",
      ).length,
      nextAppointment,
      nextIsInProgress: Boolean(inProgress),
      upcoming,

      waitingConversations,
      criticalConversations: data.conversations.filter(
        (conversation) => conversation.attention === "CRITICAL",
      ).length,

      receivedInCents,
      pendingInCents,
      overdueInCents: overdue.reduce(
        (total, transaction) => total + transaction.amountInCents,
        0,
      ),
      overdueCount: overdue.length,

      alerts: openAlerts.slice(0, ALERTS_LIMIT),
      unreadAlerts: openAlerts.filter(
        (notification) => notification.status === "UNREAD",
      ).length,
      criticalAlerts: openAlerts.filter(
        (notification) => notification.priority === "CRITICAL",
      ).length,

      recentDecisions,
      autoResponses,
      escalations,
      automationRate: data.decisions.length
        ? autoResponses / data.decisions.length
        : 0,
    };
  }, [data, now]);
}
