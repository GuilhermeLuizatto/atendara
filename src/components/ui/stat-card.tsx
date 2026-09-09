import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type StatTone = "default" | "success" | "warning" | "danger" | "accent";

const ICON_TONES: Record<StatTone, string> = {
  default: "bg-surface-muted text-muted-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  danger: "bg-danger-soft text-danger-soft-foreground",
  accent: "bg-accent-soft text-accent",
};

const VALUE_TONES: Record<StatTone, string> = {
  default: "text-foreground",
  success: "text-foreground",
  warning: "text-foreground",
  danger: "text-danger-soft-foreground",
  accent: "text-foreground",
};

/**
 * Cartao de indicador do dashboard.
 *
 * O valor usa `tabular-nums` para que numeros nao dancem quando mudam, e a
 * altura e fixa (`min-h`) para que a linha de cartoes nao pule quando um deles
 * ganha uma linha de contexto a mais.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  footer,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: StatTone;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card border-border bg-surface shadow-card flex flex-col border p-4",
        "min-h-28 sm:min-h-32",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-xs font-medium">{label}</p>
        {/* Em telas estreitas o rotulo precisa da largura toda; o icone e
            reforco visual, nao informacao. */}
        <span
          className={cn(
            "hidden size-8 shrink-0 items-center justify-center rounded-lg sm:flex",
            ICON_TONES[tone],
          )}
        >
          <Icon className="size-4" aria-hidden strokeWidth={1.75} />
        </span>
      </div>

      <p
        className={cn(
          "mt-2 text-2xl leading-none font-semibold tracking-tight tabular-nums sm:text-3xl",
          VALUE_TONES[tone],
        )}
      >
        {value}
      </p>

      {hint ? (
        <p className="text-subtle-foreground mt-1.5 text-xs">{hint}</p>
      ) : null}

      {footer ? <div className="mt-auto pt-3">{footer}</div> : null}
    </div>
  );
}
