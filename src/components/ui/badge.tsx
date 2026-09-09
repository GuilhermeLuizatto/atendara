import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type BadgeTone =
  "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "accent";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-muted-foreground border-border",
  primary: "bg-primary-soft text-primary-soft-foreground border-transparent",
  success: "bg-success-soft text-success-soft-foreground border-transparent",
  warning: "bg-warning-soft text-warning-soft-foreground border-transparent",
  danger: "bg-danger-soft text-danger-soft-foreground border-transparent",
  info: "bg-info-soft text-info-soft-foreground border-transparent",
  accent: "bg-accent-soft text-accent border-transparent",
};

const DOT_TONES: Record<BadgeTone, string> = {
  neutral: "bg-subtle-foreground",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  accent: "bg-accent",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        "text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", DOT_TONES[tone])}
        />
      ) : null}
      {children}
    </span>
  );
}
