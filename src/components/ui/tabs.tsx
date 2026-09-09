"use client";

import { cn } from "@/lib/utils/cn";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * Alternador de visao no estilo segmented control.
 *
 * Usa `role="tablist"` com navegacao por setas — o padrao ARIA para abas.
 * Um grupo de botoes soltos obrigaria o usuario de teclado a tabular por todas
 * as opcoes ate chegar no conteudo.
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = (index + offset + options.length) % options.length;
    onChange(options[next].value);
  };

  return (
    <div
      role="tablist"
      className={cn(
        "bg-surface-muted inline-flex items-center gap-0.5 rounded-lg p-0.5",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
              selected
                ? "bg-surface text-foreground shadow-card"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  selected
                    ? "bg-surface-muted text-muted-foreground"
                    : "text-subtle-foreground",
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
