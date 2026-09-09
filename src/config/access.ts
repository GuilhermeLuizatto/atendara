import type { AccountAccess, AppModule } from "@/types/access";
import type { Permission, ProfessionId } from "@/types";
import { permissionsForRole } from "./permissions";

export const PLATFORM_ADMIN_EMAIL = "guilhermeluizatto@gmail.com";
export const MODULE_LABELS: Record<AppModule, string> = {
  dashboard: "Dashboard", agenda: "Agenda", clientes: "Clientes", mensagens: "Mensagens",
  financeiro: "Financeiro", agente: "Dara", configuracoes: "Configuracoes",
};
const PERMISSION_MODULE: Partial<Record<string, AppModule>> = {
  appointment: "agenda", client: "clientes", conversation: "mensagens", transaction: "financeiro",
  rule: "agente", aiDecision: "agente", notification: "dashboard", organization: "dashboard",
};

export function isPlatformAdmin(account: AccountAccess | null | undefined): boolean {
  return account?.platformRole === "PLATFORM_ADMIN" && account.status === "ACTIVE";
}

export function hasActiveAccess(account: AccountAccess | null | undefined, now = new Date()): boolean {
  if (!account || account.mustChangePassword || account.status !== "ACTIVE") return false;
  if (isPlatformAdmin(account)) return true;
  return account.subscriptionStatus === "ACTIVE" && !!account.organizationId && !!account.professionId &&
    !!account.accessUntil && Date.parse(account.accessUntil) > now.getTime();
}

export function canAccessProfession(account: AccountAccess | null | undefined, profession: ProfessionId): boolean {
  return hasActiveAccess(account) && (isPlatformAdmin(account) || account?.professionId === profession);
}

export function canAccessModule(account: AccountAccess | null | undefined, module: AppModule): boolean {
  return hasActiveAccess(account) && (isPlatformAdmin(account) || !!account?.modules.includes(module));
}

export function accountPermissions(account: AccountAccess | null | undefined): Permission[] {
  if (!hasActiveAccess(account)) return [];
  if (isPlatformAdmin(account)) return permissionsForRole("OWNER");
  return permissionsForRole("PROFESSIONAL").filter((permission) => {
    const area = PERMISSION_MODULE[permission.split(":")[0]];
    return area ? !!account?.modules.includes(area) : false;
  });
}


