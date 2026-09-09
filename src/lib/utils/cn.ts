import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Concatena classes condicionais resolvendo conflitos do Tailwind
 * (`px-2 px-4` -> `px-4`). Usado por todos os componentes de UI.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
