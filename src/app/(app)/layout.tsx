import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

/**
 * Grupo de rotas da area autenticada. O parenteses no nome da pasta mantem
 * `(app)` fora da URL: as rotas continuam sendo `/dashboard`, `/agenda`, etc.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
