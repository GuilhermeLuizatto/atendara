import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";

import { cn } from "@/lib/utils/cn";

const CONTROL_BASE = cn(
  "w-full rounded-lg border bg-surface px-3 text-sm text-foreground",
  "placeholder:text-subtle-foreground transition-colors",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

const CONTROL_OK = "border-border focus:border-primary";
const CONTROL_ERROR = "border-danger focus:border-danger";

/**
 * Campo de formulario.
 *
 * O `id` e gerado aqui e distribuido para o rotulo, o controle e a mensagem de
 * erro. Isso garante que `label[for]` e `aria-describedby` sempre apontem para
 * o elemento certo — acessibilidade que se perde quando cada tela liga isso a
 * mao.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-foreground block text-xs font-medium">
        {label}
        {required ? (
          <span className="text-danger ml-0.5" aria-hidden>
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}

      {error ? (
        <p id={errorId} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-subtle-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(
        CONTROL_BASE,
        "h-10",
        invalid ? CONTROL_ERROR : CONTROL_OK,
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(
        CONTROL_BASE,
        "min-h-20 py-2 leading-relaxed",
        invalid ? CONTROL_ERROR : CONTROL_OK,
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  invalid,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cn(
        CONTROL_BASE,
        "h-10 cursor-pointer appearance-none pr-8",
        // Seta desenhada em CSS: evita depender de imagem externa e acompanha
        // a cor do tema.
        "bg-[image:linear-gradient(45deg,transparent_50%,currentColor_50%),linear-gradient(135deg,currentColor_50%,transparent_50%)]",
        "bg-[length:5px_5px,5px_5px] bg-[position:calc(100%-16px)_center,calc(100%-11px)_center] bg-no-repeat",
        invalid ? CONTROL_ERROR : CONTROL_OK,
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t pt-4">
      {children}
    </div>
  );
}
