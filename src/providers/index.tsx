"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "./auth-provider";
import { ThemeProvider } from "./theme-provider";
import { ToastProvider } from "./toast-provider";
import { WorkspaceProvider } from "./workspace-provider";

/**
 * Composicao dos providers globais. A ordem importa: o workspace depende da
 * sessao autenticada para resolver papel e autoria das escritas.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export { useAuth } from "./auth-provider";
export { useTheme } from "./theme-provider";
export { useToast } from "./toast-provider";
export { useWorkspaceActions } from "./use-workspace-actions";
export { useTerminology, useWorkspace } from "./workspace-provider";
