"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useMemo } from "react";

import { APP_NAME } from "@/config/app";
import { NAV_ITEMS, navLabel, type AppRoute } from "@/config/navigation";
import { canAccessModule, canManageSubscription, isPlatformAdmin } from "@/config/access";
import type { AppModule } from "@/types/access";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "@/providers/workspace-provider";

import { NavIcon } from "./nav-icon";

interface NavCount {
  value: number;
  urgent: boolean;
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { terminology, profession, organization, data } =
    useWorkspace();

  // Sem sessao resolvida ainda, mostramos a navegacao completa; a barreira real
  // de acesso sao as Security Rules, nao a sidebar.

  // Contadores no menu: o profissional ve o que precisa de atencao sem abrir
  // cada tela. So mostramos onde ha acao pendente de verdade.
  const counts = useMemo<Partial<Record<AppRoute, NavCount>>>(() => {
    if (!data) return {};

    const waiting = data.conversations.filter(
      (conversation) => conversation.status === "WAITING_PROFESSIONAL",
    );
    const overdue = data.transactions.filter(
      (transaction) => transaction.status === "OVERDUE",
    );

    return {
      "/mensagens": {
        value: waiting.length,
        urgent: waiting.some(
          (conversation) => conversation.attention === "CRITICAL",
        ),
      },
      "/financeiro": { value: overdue.length, urgent: false },
    };
  }, [data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="bg-accent text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <Sparkles className="size-4" aria-hidden strokeWidth={2} />
        </span>
        <span className="min-w-0">
          <span className="text-foreground block truncate text-sm font-semibold">
            {organization?.name ?? APP_NAME}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            {profession.label}
          </span>
        </span>
      </div>

      <nav aria-label="Principal" className="scrollbar-slim flex-1 overflow-y-auto px-2 pb-4">
        <ul className="space-y-0.5">
          {isPlatformAdmin(user?.access) ? <li><Link href="/admin" onClick={onNavigate} className="text-primary block rounded-lg px-3 py-2 text-sm font-medium">Administracao</Link></li> : null}
          {NAV_ITEMS.filter((item) => canAccessModule(user?.access, item.href.slice(1) as AppModule)).map(
            (item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const count = counts[item.href];

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary-soft text-primary-soft-foreground font-medium"
                        : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    <NavIcon
                      name={item.icon}
                      className={cn(
                        "size-4.5 shrink-0",
                        active ? "text-primary" : "text-subtle-foreground",
                      )}
                    />
                    <span className="flex-1 truncate">
                      {navLabel(item, terminology)}
                    </span>

                    {count && count.value > 0 ? (
                      <>
                        <span
                          aria-hidden
                          className={cn(
                            "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5",
                            "text-[11px] font-semibold tabular-nums",
                            count.urgent
                              ? "bg-danger text-danger-foreground"
                              : "bg-surface-muted text-muted-foreground",
                          )}
                        >
                          {count.value}
                        </span>
                        {/* `aria-label` em span e ignorado por varios leitores:
                            o numero vai como texto do proprio link. */}
                        <span className="sr-only">
                          , {count.value} pendente{count.value > 1 ? "s" : ""}
                        </span>
                      </>
                    ) : null}
                  </Link>
                </li>
              );
            },
          )}
          {/* Fora de NAV_ITEMS de proposito: "Minha assinatura" nao e um modulo
              do produto e nao depende da matriz RBAC do tenant — quem entra e
              quem responde pela organizacao. E precisa aparecer mesmo com a
              mensalidade vencida, que e quando ela mais faz falta. */}
          {canManageSubscription(user?.access) ? (
            <li>
              <Link
                href="/assinatura"
                onClick={onNavigate}
                aria-current={pathname.startsWith("/assinatura") ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  pathname.startsWith("/assinatura")
                    ? "bg-primary-soft text-primary-soft-foreground font-medium"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                )}
              >
                <NavIcon name="finance" className="size-4.5 shrink-0 text-subtle-foreground" />
                <span className="flex-1 truncate">Minha assinatura</span>
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>

      <div className="border-border border-t px-4 py-3">
        <p className="text-subtle-foreground text-[11px] leading-relaxed">
          A IA auxilia. O humano decide.
        </p>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="border-border bg-surface hidden w-60 shrink-0 border-r lg:block">
      <div className="sticky top-0 h-dvh">
        <SidebarContent />
      </div>
    </aside>
  );
}

