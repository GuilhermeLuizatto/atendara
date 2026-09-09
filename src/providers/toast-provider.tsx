"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils/cn";

export type ToastTone = "success" | "danger" | "info";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4500;

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-success/40 bg-success-soft text-success-soft-foreground",
  danger: "border-danger/40 bg-danger-soft text-danger-soft-foreground",
  info: "border-border bg-surface text-foreground",
};

const TONE_ICONS = {
  success: CircleCheck,
  danger: CircleAlert,
  info: Info,
} as const;

/**
 * Feedback efemero de acao.
 *
 * Sem isso, criar um cadastro ou receber um erro de validacao acontece em
 * silencio: a linha aparece (ou nao) no meio de uma lista e o usuario fica sem
 * saber se a acao funcionou.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* `aria-live=polite` anuncia sem interromper o que o leitor de tela
          esteja narrando; erros de acao nao sao emergencia. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-center gap-2 sm:right-6 sm:bottom-6 sm:left-auto sm:items-end"
      >
        {toasts.map((toast) => {
          const Icon = TONE_ICONS[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                "rounded-card shadow-overlay pointer-events-auto flex w-full max-w-sm items-start gap-2.5 border px-3.5 py-3",
                TONE_STYLES[toast.tone],
              )}
            >
              <Icon
                className="mt-0.5 size-4 shrink-0"
                aria-hidden
                strokeWidth={2}
              />
              <p className="flex-1 text-sm leading-snug">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Fechar aviso"
                className="-mt-0.5 -mr-1 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="size-3.5" aria-hidden strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast precisa estar dentro de <ToastProvider>.");
  }
  return context;
}
