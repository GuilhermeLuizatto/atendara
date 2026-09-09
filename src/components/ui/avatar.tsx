import { cn } from "@/lib/utils/cn";
import { initials } from "@/lib/utils/format";

const SIZES = {
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const;

/**
 * Avatar por iniciais. Nao usamos foto no prototipo: dados ficticios com rosto
 * real seriam enganosos, e iniciais mantem a interface legivel.
 */
export function Avatar({
  name,
  size = "md",
  tone = "muted",
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  tone?: "muted" | "accent" | "primary";
  className?: string;
}) {
  const toneClasses = {
    muted: "bg-surface-muted text-muted-foreground border-border",
    accent: "bg-accent-soft text-accent border-transparent",
    primary: "bg-primary-soft text-primary-soft-foreground border-transparent",
  }[tone];

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border font-semibold",
        SIZES[size],
        toneClasses,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
