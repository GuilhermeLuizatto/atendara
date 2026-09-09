"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { authAdapter, type AuthMode } from "@/lib/auth";
import type { AuthenticatedUser } from "@/types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  /** "demo" quando nao ha projeto Firebase configurado. */
  mode: AuthMode;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    // O adaptador emite o estado atual na inscricao, entao "loading" so dura
    // ate a primeira notificacao.
    return authAdapter.subscribe((nextUser) => {
      setUser(nextUser);
      setStatus(nextUser ? "authenticated" : "unauthenticated");
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const nextUser = await authAdapter.signIn(email, password);
    setUser(nextUser);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    await authAdapter.signOut();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(
    () => ({ status, user, mode: authAdapter.mode, signIn, signOut }),
    [status, user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth precisa estar dentro de <AuthProvider>.");
  }
  return context;
}
