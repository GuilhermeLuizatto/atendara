"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { createPreferenceStore } from "@/lib/storage/preference-store";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "atendo:theme";

const themeStore = createPreferenceStore<ThemePreference>(
  STORAGE_KEY,
  "system",
  (raw) => (raw === "light" || raw === "dark" || raw === "system" ? raw : null),
);

/**
 * Store do `prefers-color-scheme`. E uma fonte externa de verdade que muda
 * sozinha (o usuario altera o tema do sistema operacional), entao tambem entra
 * por `useSyncExternalStore` em vez de um efeito com `setState`.
 */
const systemThemeStore = {
  subscribe(onStoreChange: () => void) {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", onStoreChange);
    return () => media.removeEventListener("change", onStoreChange);
  },
  getSnapshot(): "light" | "dark" {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  },
  getServerSnapshot(): "light" | "dark" {
    return "light";
  },
};

interface ThemeContextValue {
  preference: ThemePreference;
  /** Tema efetivamente aplicado, depois de resolver "system". */
  resolved: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Script sincrono executado antes da hidratacao para aplicar o tema salvo sem
 * piscar branco. Precisa ser minusculo — por isso vai inline no <head>.
 */
export const themeInitScript = `
(function(){try{
var p=localStorage.getItem('${STORAGE_KEY}');
var d=p==='dark'||((!p||p==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark',d);
}catch(e){}})();
`.trim();

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot,
  );

  const systemTheme = useSyncExternalStore(
    systemThemeStore.subscribe,
    systemThemeStore.getSnapshot,
    systemThemeStore.getServerSnapshot,
  );

  const resolved = preference === "system" ? systemTheme : preference;

  // Unica responsabilidade do efeito: refletir o estado no DOM. Nenhum
  // `setState` aqui, entao nao ha render em cascata.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    themeStore.set(next);
  }, []);

  const toggle = useCallback(() => {
    themeStore.set(resolved === "dark" ? "light" : "dark");
  }, [resolved]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme precisa estar dentro de <ThemeProvider>.");
  }
  return context;
}
