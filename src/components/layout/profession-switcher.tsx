"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";

import { listProfessions } from "@/config/professions";
import { cn } from "@/lib/utils/cn";
import { useDismissable } from "@/lib/utils/use-dismissable";
import { useWorkspace } from "@/providers/workspace-provider";
import { useAuth } from "@/providers/auth-provider";
import { isPlatformAdmin } from "@/config/access";
import type { ProfessionId } from "@/types";

/**
 * Troca a profissao ativa.
 *
 * E o controle que evidencia a tese do produto: o mesmo sistema, com a mesma
 * estrutura de dados, muda terminologia, taxonomia de mensagens, regras e cor
 * de destaque conforme a profissao — sem recarregar a aplicacao.
 */
export function ProfessionSwitcher() {
  const { user } = useAuth();
  const { profession, setProfession } = useWorkspace();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, containerRef, close, triggerRef);

  // Para quem nao e a operadora a profissao e fixa e ja esta na barra lateral;
  // no celular o espaco do cabecalho vai para o que se usa.
  if (!isPlatformAdmin(user?.access)) {
    return (
      <span className="text-muted-foreground hidden px-3 text-sm sm:inline">
        {profession.label}
      </span>
    );
  }

  const choose = (id: ProfessionId) => {
    setProfession(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Profissao da demonstracao: ${profession.label}`}
        className={cn(
          "border-border inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 sm:px-3",
          "bg-surface text-foreground text-sm font-medium transition-colors",
          "hover:bg-surface-muted",
        )}
      >
        <span aria-hidden className="bg-accent size-2 rounded-full" />
        <span className="hidden max-w-32 truncate sm:block">
          {profession.label}
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
            "rounded-card absolute right-0 z-50 mt-2 overflow-hidden",
            "border-border bg-surface shadow-overlay w-[min(20rem,calc(100vw-2rem))] border",
          )}
        >
          <p className="border-border text-subtle-foreground border-b px-3 py-2 text-[11px] font-medium tracking-wide uppercase">
            Trocar profissao
          </p>
          <ul className="scrollbar-slim max-h-80 overflow-y-auto p-1">
            {listProfessions().map((item) => {
              const selected = item.id === profession.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => choose(item.id)}
                    data-accent={item.accent}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left",
                      "hover:bg-surface-muted transition-colors",
                      selected && "bg-surface-muted",
                    )}
                  >
                    <span
                      aria-hidden
                      className="bg-accent mt-1.5 size-2 shrink-0 rounded-full"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block text-sm font-medium">
                        {item.label}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {item.terminology.client.plural} ·{" "}
                        {item.terminology.appointment.pluralLower}
                      </span>
                    </span>
                    {selected ? (
                      <Check
                        className="text-primary mt-0.5 size-4 shrink-0"
                        aria-hidden
                        strokeWidth={2}
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
