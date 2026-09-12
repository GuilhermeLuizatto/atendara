"use client";

import Link from "next/link";
import { ChevronDown, LogOut, RotateCcw, Settings } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/config/permissions";
import { isPlatformAdmin } from "@/config/access";
import { cn } from "@/lib/utils/cn";
import { useDismissable } from "@/lib/utils/use-dismissable";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspaceActions } from "@/providers/use-workspace-actions";
import { useWorkspace } from "@/providers/workspace-provider";

const ITEM_CLASSES =
  "text-muted-foreground hover:bg-surface-muted hover:text-foreground flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors";

/**
 * Menu da conta. Botao que abre e fecha uma lista de links (padrao
 * disclosure): `role="menu"` prometeria navegacao por setas que um punhado de
 * links nao precisa.
 */
export function UserMenu() {
  const { signOut } = useAuth();
  const { session, organization, repository } = useWorkspace();
  const { reset } = useWorkspaceActions();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, containerRef, close, triggerRef);

  const displayName = session?.user.displayName ?? "Carregando...";
  const roleLabel = session
    ? isPlatformAdmin(session.user.access)
      ? "Administrador da plataforma"
      : `${ROLE_LABELS[session.role]}${session.isOrganizationHolder ? " · titular" : ""}`
    : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Conta de ${displayName}`}
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
          id={panelId}
          className={cn(
            "rounded-card border-border bg-surface shadow-overlay absolute right-0 z-50",
            "mt-2 w-[min(16rem,calc(100vw-2rem))] overflow-hidden border",
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
              {roleLabel ? <Badge tone="primary">{roleLabel}</Badge> : null}
              {organization ? (
                <span className="text-subtle-foreground truncate text-[11px]">
                  {organization.name}
                </span>
              ) : null}
            </div>
          </div>

          <ul className="p-1">
            <li>
              <Link href="/configuracoes" onClick={close} className={ITEM_CLASSES}>
                <Settings className="size-4" aria-hidden strokeWidth={1.75} />
                Configurações
              </Link>
            </li>
            {/* O prototipo guarda as alteracoes no navegador; sem uma saida
                explicita, um experimento ruim ficaria preso para sempre. */}
            {repository?.mode === "memory" ? (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    void reset();
                  }}
                  className={ITEM_CLASSES}
                >
                  <RotateCcw className="size-4" aria-hidden strokeWidth={1.75} />
                  Restaurar dados de demonstração
                </button>
              </li>
            ) : null}
            <li>
              <button
                type="button"
                onClick={() => {
                  close();
                  void signOut();
                }}
                className={ITEM_CLASSES}
              >
                <LogOut className="size-4" aria-hidden strokeWidth={1.75} />
                Sair da conta
              </button>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
