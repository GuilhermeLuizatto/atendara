"use client";

import Link from "next/link";
import { ChevronDown, LogOut, RotateCcw, Settings } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/config/permissions";
import { isPlatformAdmin } from "@/config/access";
import { cn } from "@/lib/utils/cn";
import { useDismissable } from "@/lib/utils/use-dismissable";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";

export function UserMenu() {
  const { signOut } = useAuth();
  const { session, organization, repository } = useWorkspace();
  const { reset } = useWorkspaceActions();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, containerRef, close);

  const displayName = session?.user.displayName ?? "Carregando...";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "hover:bg-surface-muted flex h-9 items-center gap-2 rounded-lg px-1.5 transition-colors",
          open && "bg-surface-muted",
        )}
      >
        <Avatar name={displayName} size="sm" tone="accent" />
        <span className="text-foreground hidden max-w-32 truncate text-sm font-medium sm:block">
          {displayName}
        </span>
        <ChevronDown
          className={cn(
            "text-subtle-foreground size-4 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
          strokeWidth={1.75}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "rounded-card border-border bg-surface shadow-overlay absolute right-0 z-50",
            "mt-2 w-64 overflow-hidden border",
          )}
        >
          <div className="border-border border-b px-4 py-3">
            <p className="text-foreground truncate text-sm font-medium">
              {displayName}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {session?.user.email}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {session ? (
                <Badge tone="primary">{isPlatformAdmin(session.user.access) ? "Administrador da plataforma" : ROLE_LABELS[session.role]}</Badge>
              ) : null}
              {organization ? (
                <span className="text-subtle-foreground truncate text-[11px]">
                  {organization.name}
                </span>
              ) : null}
            </div>
          </div>

          <div className="p-1">
            <Link
              href="/configuracoes"
              role="menuitem"
              onClick={close}
              className="text-muted-foreground hover:bg-surface-muted hover:text-foreground flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors"
            >
              <Settings className="size-4" aria-hidden strokeWidth={1.75} />
              Configuracoes
            </Link>
            {/* O prototipo guarda as alteracoes no navegador; sem uma saida
                explicita, um experimento ruim ficaria preso para sempre. */}
            {repository?.mode === "memory" ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  void reset();
                }}
                className="text-muted-foreground hover:bg-surface-muted hover:text-foreground flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors"
              >
                <RotateCcw className="size-4" aria-hidden strokeWidth={1.75} />
                Restaurar dados de demonstracao
              </button>
            ) : null}

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                void signOut();
              }}
              className="text-muted-foreground hover:bg-surface-muted hover:text-foreground flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors"
            >
              <LogOut className="size-4" aria-hidden strokeWidth={1.75} />
              Sair da conta
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
