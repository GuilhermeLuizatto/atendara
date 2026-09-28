"use client";

import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";

import { applyMask } from "@/lib/utils/mask";

import { Input } from "./form";

/**
 * Campo com mascara aplicada enquanto se digita. Guarda o cursor pelo numero de
 * letras e numeros antes dele: sem isso, corrigir um digito no meio jogaria o
 * cursor para o fim a cada tecla.
 */
export function MaskedInput({
  value,
  format,
  onValueChange,
  invalid,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  format: (raw: string) => string;
  onValueChange: (formatted: string) => void;
  invalid?: boolean;
}) {
  const pendingCaret = useRef<{ element: HTMLInputElement; position: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    pendingCaret.current = null;
    if (pending && pending.element === document.activeElement) {
      pending.element.setSelectionRange(pending.position, pending.position);
    }
  }, [value]);

  return (
    <Input
      {...props}
      invalid={invalid}
      value={value}
      onChange={(event) => {
        const element = event.currentTarget;
        const inputType = (event.nativeEvent as InputEvent).inputType;
        const next = applyMask(element.value, element.selectionStart ?? element.value.length, value, inputType, format);
        if (next.value === value) {
          // Sem mudanca nao ha nova renderizacao: o React devolve o valor ao
          // campo depois deste manipulador e o cursor iria para o fim.
          queueMicrotask(() => element.setSelectionRange(next.caret, next.caret));
          return;
        }
        pendingCaret.current = { element, position: next.caret };
        onValueChange(next.value);
      }}
    />
  );
}
