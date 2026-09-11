"use client";

import { BellOff, Check, ShieldAlert, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ATTENTION_TONE } from "@/components/ui/tones";
import { ATTENTION_LABELS, NOTIFICATION_TYPE_LABELS } from "@/config/labels";
import { cn } from "@/lib/utils/cn";
import { formatRelativeToNow } from "@/lib/utils/format";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import type { Notification } from "@/types";

/**
 * Painel de alertas.
 *
 * Alertas criticos nao competem por atencao com os demais: recebem fundo
 * proprio, barra lateral e icone distinto. Isso e requisito de produto, nao
 * enfeite — e o canal pelo qual o agente interrompe a automacao e chama o
 * humano.
 */
export function AlertsPanel({
  alerts,
  criticalCount,
  now,
}: {
  alerts: Notification[];
  criticalCount: number;
  now: Date;
}) {
  const { acknowledgeNotification, markAllNotificationsRead } =
    useWorkspaceActions();

  return (
    <Card>
      <CardHeader>
        <CardTitle
          action={
            alerts.length > 0 ? (
              <button
                type="button"
                onClick={() => void markAllNotificationsRead()}
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                Marcar como lidos
              </button>
            ) : null
          }
        >
          <span className="flex items-center gap-2">
            Alertas
            {criticalCount > 0 ? (
              <Badge tone="danger" dot>
                {criticalCount} critico{criticalCount > 1 ? "s" : ""}
              </Badge>
            ) : null}
          </span>
        </CardTitle>
      </CardHeader>

      {alerts.length === 0 ? (
        <EmptyState
          icon={<BellOff className="size-5" aria-hidden />}
          title="Nenhum alerta aberto"
          description="Voce sera avisado aqui quando o agente precisar de voce."
        />
      ) : (
        <ul className="divide-border divide-y">
          {alerts.map((alert) => {
            const critical = alert.priority === "CRITICAL";
            const Icon = critical ? ShieldAlert : TriangleAlert;

            return (
              <li
                key={alert.id}
                className={cn(
                  "relative flex gap-3 px-5 py-3.5",
                  critical && "bg-danger-soft/40",
                )}
              >
                {critical ? (
                  <span
                    aria-hidden
                    className="bg-danger absolute inset-y-0 left-0 w-0.5"
                  />
                ) : null}

                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
                    critical
                      ? "bg-danger text-danger-foreground"
                      : "bg-warning-soft text-warning-soft-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden strokeWidth={2} />
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-foreground text-sm font-medium">
                      {alert.title}
                    </p>
                    <Badge tone={ATTENTION_TONE[alert.priority]}>
                      {ATTENTION_LABELS[alert.priority]}
                    </Badge>
                  </div>

                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {alert.body}
                  </p>

                  <div className="text-subtle-foreground flex items-center gap-2 text-[11px]">
                    <span>{NOTIFICATION_TYPE_LABELS[alert.type]}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={alert.createdAt}>
                      {formatRelativeToNow(alert.createdAt, now)}
                    </time>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void acknowledgeNotification(alert.id)}
                  aria-label={`Resolver alerta: ${alert.title}`}
                  title="Marcar como resolvido"
                  className="shrink-0"
                >
                  <Check className="size-4" aria-hidden strokeWidth={2} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
