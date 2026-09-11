"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * Alternador de visao no estilo segmented control.
 *
 * Padrao ARIA de abas: um so ponto de parada no Tab, setas e Home/End trocam a
 * aba e levam o foco junto. Com `idBase`, cada aba aponta para o `TabPanel`
 * que controla; sem ele, o conteudo trocado e a propria tela ao lado.
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  className,
  label,
  idBase,
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Nome do grupo para leitor de tela, quando o contexto nao diz. */
  label?: string;
  idBase?: string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = options.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % options.length
        : event.key === "ArrowLeft"
          ? (index - 1 + options.length) % options.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "bg-surface-muted inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg p-0.5",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={idBase ? `${idBase}-tab-${option.value}` : undefined}
            aria-controls={idBase ? `${idBase}-panel-${option.value}` : undefined}
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

export function TabPanel({
  idBase,
  value,
  className,
  children,
}: {
  idBase: string;
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-tab-${value}`}
      className={className}
    >
      {children}
    </div>
  );
}
