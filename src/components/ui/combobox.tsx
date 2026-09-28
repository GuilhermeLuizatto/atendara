"use client";

import { useId, useState, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

import { Input } from "./form";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Texto menor ao lado do rotulo, por exemplo a UF. */
  hint?: string;
}

/**
 * Campo com sugestoes no padrao combobox da ARIA 1.2: o foco fica no campo, as
 * setas percorrem a lista, Enter escolhe e Esc fecha. As opcoes vem de quem usa;
 * aqui so se desenha e se navega.
 */
export function Combobox({
  value,
  onValueChange,
  options,
  onSelect,
  emptyMessage,
  invalid,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onSelect"> & {
  value: string;
  onValueChange: (text: string) => void;
  options: ComboboxOption[];
  onSelect: (option: ComboboxOption) => void;
  /** Mostrado quando ha texto e nenhuma opcao. */
  emptyMessage: string;
  invalid?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const active = activeIndex < options.length ? activeIndex : -1;
  const visible = open && value.trim().length > 0;
  const optionId = (index: number) => `${listId}-option-${index}`;

  function choose(option: ComboboxOption) {
    onSelect(option);
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div className="relative">
      <Input
        {...props}
        className={className}
        invalid={invalid}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible && options.length > 0}
        aria-controls={listId}
        aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onBlur={(event) => {
          setOpen(false);
          props.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (!options.length) return;
            event.preventDefault();
            setOpen(true);
            const step = event.key === "ArrowDown" ? 1 : -1;
            if (active < 0) setActiveIndex(step > 0 ? 0 : options.length - 1);
            else setActiveIndex((active + step + options.length) % options.length);
          } else if (event.key === "Enter" && visible && options.length > 0) {
            // Com a lista aberta, Enter nunca envia o formulario: escolhe a
            // opcao marcada, a unica que houver, ou marca a primeira.
            event.preventDefault();
            if (active >= 0) choose(options[active]);
            else if (options.length === 1) choose(options[0]);
            else setActiveIndex(0);
          } else if (event.key === "Escape" && visible) {
            event.preventDefault();
            setOpen(false);
          }
          props.onKeyDown?.(event);
        }}
      />
      <ul
        id={listId}
        role="listbox"
        className={cn(
          "border-border bg-surface shadow-overlay absolute z-20 mt-1 w-full overflow-hidden rounded-lg border py-1",
          !(visible && options.length > 0) && "hidden",
        )}
      >
        {options.map((option, index) => (
          <li
            key={option.value}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            // Sem isto o campo perde o foco antes do clique e a lista fecha.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
            className={cn(
              "flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm",
              index === active ? "bg-primary-soft text-primary-soft-foreground" : "text-foreground hover:bg-surface-hover",
            )}
          >
            <span>{option.label}</span>
            {option.hint ? <span className="text-muted-foreground text-xs">{option.hint}</span> : null}
          </li>
        ))}
      </ul>
      {visible && options.length === 0 ? (
        <p className="border-border bg-surface text-muted-foreground shadow-overlay absolute z-20 mt-1 w-full rounded-lg border px-3 py-2 text-sm">
          {emptyMessage}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {visible ? (options.length ? `${options.length} sugestões. Use as setas para escolher.` : emptyMessage) : ""}
      </p>
    </div>
  );
}
