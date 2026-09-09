"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "@/providers/workspace-provider";

import { Header } from "./header";
import { RequireAuth } from "./require-auth";
import { Sidebar, SidebarContent } from "./sidebar";

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

  return (
    <RequireAuth>
      <div
        data-accent={profession.accent}
        className="bg-background flex min-h-dvh"
      >
        <Sidebar />

        {menuOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Fechar menu"
              onClick={() => setMenuOpen(false)}
              className="bg-foreground/40 absolute inset-0 backdrop-blur-[2px]"
            />
            <div
              className={cn(
                "border-border bg-surface absolute inset-y-0 left-0 w-64 border-r",
                "shadow-overlay",
              )}
            >
              <div className="absolute top-3 right-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Fechar menu"
                >
                  <X className="size-4" aria-hidden strokeWidth={1.75} />
                </Button>
              </div>
              <SidebarContent onNavigate={() => setMenuOpen(false)} />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <Header onOpenMenu={() => setMenuOpen(true)} />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}
