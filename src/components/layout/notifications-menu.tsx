"use client";

import Link from "next/link";
import { Bell, BellOff, Check } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ATTENTION_TONE } from "@/components/ui/tones";
import { ATTENTION_LABELS } from "@/config/labels";
import { cn } from "@/lib/utils/cn";
import { formatRelativeToNow } from "@/lib/utils/format";
import { useDismissable } from "@/lib/utils/use-dismissable";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";

const ATTENTION_RANK = {
  CRITICAL: 0,
  HIGH: 1,
  ATTENTION: 2,
  NORMAL: 3,
} as const;

export function NotificationsMenu() {
  const { data } = useWorkspace();
  const { acknowledgeNotification, markAllNotificationsRead } =
    useWorkspaceActions();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, containerRef, close);

  const openAlerts = (data?.notifications ?? [])
    .filter((notification) => notification.status !== "ACKNOWLEDGED")
    .sort(
      (a, b) =>
        ATTENTION_RANK[a.priority] - ATTENTION_RANK[b.priority] ||
        b.createdAt.localeCompare(a.createdAt),
    );

  const unread = openAlerts.filter(
    (notification) => notification.status === "UNREAD",
  ).length;
  const hasCritical = openAlerts.some(
    (notification) => notification.priority === "CRITICAL",
  );

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unread > 0 ? `Notificações: ${unread} não lidas` : "Notificações"
        }
      >
        <Bell className="size-4" aria-hidden strokeWidth={1.75} />
      </Button>

      {unread > 0 ? (
        <span
          aria-hidden
          className={cn(
            "ring-surface absolute top-1.5 right-1.5 size-2 rounded-full ring-2",
            hasCritical ? "bg-danger" : "bg-warning",
          )}
        />
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-label="Notificações"
          className={cn(
            "rounded-card border-border bg-surface shadow-overlay absolute right-0 z-50",
            "mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden border",
          )}
        >
          <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
            <p className="text-foreground text-sm font-semibold">Alertas</p>
            {openAlerts.length > 0 ? (
              <button
                type="button"
                onClick={() => void markAllNotificationsRead()}
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                Marcar como lidos
              </button>
            ) : null}
          </div>

          {openAlerts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              <BellOff
                className="text-subtle-foreground size-5"
                aria-hidden
                strokeWidth={1.75}
              />
              <p className="text-muted-foreground text-xs">
                Nenhum alerta aberto.
              </p>
            </div>
          ) : (
            <ul className="divide-border scrollbar-slim max-h-80 divide-y overflow-y-auto">
              {openAlerts.map((alert) => (
                <li
                  key={alert.id}
                  className={cn(
                    "flex gap-2.5 px-4 py-3",
                    alert.priority === "CRITICAL" && "bg-danger-soft/40",
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-foreground text-xs font-medium">
                        {alert.title}
                      </p>
                      <Badge tone={ATTENTION_TONE[alert.priority]}>
                        {ATTENTION_LABELS[alert.priority]}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {alert.body}
                    </p>
                    <time
                      dateTime={alert.createdAt}
                      className="text-subtle-foreground block text-[11px]"
                    >
                      {formatRelativeToNow(alert.createdAt)}
                    </time>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void acknowledgeNotification(alert.id)}
                    aria-label={`Resolver alerta: ${alert.title}`}
                    title="Marcar como resolvido"
                    className="size-7 shrink-0"
                  >
                    <Check className="size-3.5" aria-hidden strokeWidth={2} />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-border border-t px-4 py-2.5">
            <Link
              href="/mensagens"
              onClick={close}
              className="text-primary text-xs font-medium hover:underline"
            >
              Ir para a central de mensagens
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
