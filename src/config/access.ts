import type { AccountAccess, AppModule } from "@/types/access";
import type { Permission, ProfessionId, Role } from "@/types";
import { permissionsForMembership, permissionsForRole } from "./permissions";

export const PLATFORM_ADMIN_EMAIL = "guilhermeluizatto@gmail.com";
export const MODULE_LABELS: Record<AppModule, string> = {
  dashboard: "Dashboard", agenda: "Agenda", clientes: "Clientes", mensagens: "Mensagens",
  financeiro: "Financeiro", agente: "Dara", configuracoes: "Configuracoes",
};
// Permissao sem area aqui fica fora da sessao: membros, cobranca e pedidos de
// titular ainda nao tem tela, e o que nao tem tela nao precisa estar liberado.
const PERMISSION_MODULE: Partial<Record<string, AppModule>> = {
  appointment: "agenda", client: "clientes", conversation: "mensagens", transaction: "financeiro",
  rule: "agente", aiDecision: "agente", notification: "dashboard", organization: "dashboard",
  notificationSettings: "configuracoes", auditLog: "configuracoes",
};

/**
 * O vinculo de quem usa o painel. O papel vem de `members/{uid}`, o documento
 * que as rules conferem; ser titular vem do `ownerId` da organizacao.
 */
export interface MembershipContext {
  role: Role;
  isOrganizationHolder: boolean;
}

const UNRESOLVED_MEMBERSHIP: MembershipContext = { role: "PROFESSIONAL", isOrganizationHolder: false };

export function isPlatformAdmin(account: AccountAccess | null | undefined): boolean {
  return account?.platformRole === "PLATFORM_ADMIN" && account.status === "ACTIVE";
}

export function hasActiveAccess(account: AccountAccess | null | undefined, now = new Date()): boolean {
  if (!account || account.mustChangePassword || account.status !== "ACTIVE") return false;
  if (isPlatformAdmin(account)) return true;
  return account.subscriptionStatus === "ACTIVE" && !!account.organizationId && !!account.professionId &&
    !!account.accessUntil && Date.parse(account.accessUntil) > now.getTime();
}

/**
 * Quem alcanca "Minha assinatura".
 *
 * Nao usa `hasActiveAccess` de proposito: com a mensalidade vencida o painel
 * fecha, e e justamente ai que a pessoa precisa abrir a propria cobranca para
 * regularizar. Esconder a tela seria conveniencia de interface; quem decide de
 * verdade sao as Security Rules (`subscriptionOwner`) e a callable, que confere
 * o `ownerId` da organizacao no servidor.
 */
export function canManageSubscription(account: AccountAccess | null | undefined): boolean {
  return !!account && account.status === "ACTIVE" && !account.mustChangePassword &&
    account.platformRole === "PROFESSIONAL" && !!account.organizationId;
}

export function canAccessProfession(account: AccountAccess | null | undefined, profession: ProfessionId): boolean {
  return hasActiveAccess(account) && (isPlatformAdmin(account) || account?.professionId === profession);
}

export function canAccessModule(account: AccountAccess | null | undefined, module: AppModule): boolean {
  return hasActiveAccess(account) && (isPlatformAdmin(account) || !!account?.modules.includes(module));
}

/**
 * Permissoes da sessao sobre o workspace ABERTO.
 *
 * A operadora recebe as de OWNER porque o workspace dela e sempre o conjunto
 * demonstrativo em memoria (`WorkspaceProvider` passa `organizationId: null`).
 * Nao e acesso a tenant: as Security Rules negam a ela todo dado operacional,
 * e os atos reais dela estao em `PLATFORM_ROLE_PERMISSIONS`.
 */
export function accountPermissions(
  account: AccountAccess | null | undefined,
  membership: MembershipContext = UNRESOLVED_MEMBERSHIP,
): Permission[] {
  if (!hasActiveAccess(account)) return [];
  if (isPlatformAdmin(account)) return permissionsForRole("OWNER");
  return permissionsForMembership(membership.role, membership.isOrganizationHolder).filter((permission) => {
    const area = PERMISSION_MODULE[permission.split(":")[0]];
    return area ? !!account?.modules.includes(area) : false;
  });
}


