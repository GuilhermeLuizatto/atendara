"use client";

import { X } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useDialogFocus } from "@/lib/utils/use-dialog-focus";
import { useWorkspace } from "@/providers/workspace-provider";

import { Header } from "./header";
import { RequireAuth } from "./require-auth";
import { Sidebar, SidebarContent } from "./sidebar";
import { WorkspaceGate } from "./workspace-status";

/**
 * Estrutura da area autenticada: sidebar fixa no desktop, gaveta no mobile,
 * header sticky e area de conteudo com largura maxima legivel.
 *
 * O `data-accent` fica aqui, no topo: todos os componentes abaixo resolvem
 * `--accent` a partir da profissao ativa sem receber prop nenhuma.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { profession } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDialogFocus(menuOpen, menuRef, closeMenu);

  return (
    <RequireAuth>
      <div
        data-accent={profession.accent}
        className="bg-background flex min-h-dvh"
      >
        {/* Primeiro item do Tab: sem ele, quem usa teclado atravessa o menu
            inteiro em cada pagina antes de chegar ao conteudo (WCAG 2.4.1). */}
        <a
          href="#conteudo"
          className={cn(
            "bg-primary text-primary-foreground fixed top-2 left-2 z-[100] rounded-lg px-3 py-2 text-sm font-medium",
            "-translate-y-16 focus:translate-y-0",
          )}
        >
          Pular para o conteudo
        </a>

        <Sidebar />

        {menuOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              aria-hidden
              onClick={closeMenu}
              className="bg-foreground/40 absolute inset-0 backdrop-blur-[2px]"
            />
            <div
              ref={menuRef}
              role="dialog"
              aria-modal="true"
              aria-label="Menu de navegacao"
              tabIndex={-1}
              className={cn(
                "border-border bg-surface absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r outline-none",
                "shadow-overlay",
              )}
            >
              <div className="absolute top-3 right-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={closeMenu}
                  aria-label="Fechar menu"
                >
                  <X className="size-4" aria-hidden strokeWidth={1.75} />
                </Button>
              </div>
              <SidebarContent onNavigate={closeMenu} />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <Header onOpenMenu={() => setMenuOpen(true)} />
          <main
            id="conteudo"
            tabIndex={-1}
            className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8"
          >
            <div className="mx-auto w-full max-w-7xl">
              <WorkspaceGate>{children}</WorkspaceGate>
            </div>
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}
