"use client";

import { Tabs } from "@/components/ui/tabs";
import { useWorkspace } from "@/providers/workspace-provider";

/** Seleção global e explícita do contexto operacional — nunca oferece "Todos". */
export function ProfessionalContextTabs() {
  const {
    availableProfessionals,
    activeProfessionalId,
    setActiveProfessionalId,
  } = useWorkspace();

  if (!activeProfessionalId || availableProfessionals.length === 0) return null;

  return (
    <div className="border-border bg-surface sticky top-14 z-30 border-b px-3 py-2 sm:px-5">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 overflow-x-auto">
        <span className="text-subtle-foreground shrink-0 text-[11px] font-medium tracking-wide uppercase">
          Contexto
        </span>
        <Tabs
          label="Profissional ativo"
          value={activeProfessionalId}
          onChange={setActiveProfessionalId}
          options={availableProfessionals.map((professional) => ({
            value: professional.id,
            label: professional.displayName,
          }))}
          className="shrink-0 flex-nowrap"
        />
      </div>
    </div>
  );
}
