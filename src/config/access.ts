import type { AccountAccess, AppModule } from "@/types/access";
import type { Permission, ProfessionId, Role } from "@/types";
import { permissionsForMembership, permissionsForRole } from "./permissions";

export const PLATFORM_ADMIN_EMAIL = "guilhermeluizatto@gmail.com";

/**
 * De quanto em quanto tempo o navegador reconfere se o acesso ainda vale.
 *
 * O acesso vence pela HORA, sem nenhuma escrita que avise o cliente. Sem este
 * tique, a tela e as leituras abertas seguiriam como estavam ate a proxima
 * navegacao (S-13). Quinze segundos e a janela maxima em que uma sessao vencida
 * ainda recebe dado.
 */
export const ACCESS_RECHECK_INTERVAL_MS = 15_000;
export const MODULE_LABELS: Record<AppModule, string> = {
  dashboard: "Dashboard", agenda: "Agenda", clientes: "Clientes", mensagens: "Mensagens",
  financeiro: "Financeiro", agente: "Dara", configuracoes: "Configurações",
  equipe: "Equipe", importacao: "Importação", suporte: "Suporte",
};

/** Temporario enquanto o catalogo da Fase 5 permanece em definicao. */
export const PILOT_OPEN_MODULES: readonly AppModule[] = ["equipe", "importacao", "suporte"];
/**
 * Area do painel de cada recurso.
 *
 * Permissao cujo recurso nao esta aqui **some da sessao em silencio** — e o que
 * aconteceu com `notificationConsent:record`, que tem tela e trava de escrita
 * desde sempre e mesmo assim nunca chegava a ninguem. A lista do que fica de
 * fora de proposito vive em `OUT_OF_SESSION_RESOURCES`, no teste: recurso
 * novo que nao entre em nenhuma das duas derruba a suite, em vez de sumir.
 */
const PERMISSION_MODULE: Partial<Record<string, AppModule>> = {
  appointment: "agenda", service: "agenda", client: "clientes", conversation: "mensagens", transaction: "financeiro",
  rule: "agente", aiDecision: "agente", notification: "dashboard", organization: "dashboard",
  notificationSettings: "configuracoes", agendaSettings: "dashboard", auditLog: "configuracoes",
  // Registrado na ficha do cadastro, pela mesma tela que cria e edita o
  // cadastro. Sem isto, ninguem consegue registrar consentimento — e sem
  // consentimento nenhum aviso pode sair (regra 11).
  notificationConsent: "clientes",
  automationQueue: "agenda",
  member: "equipe",
  organizationBranding: "configuracoes",
  import: "importacao",
  support: "suporte",
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
  return hasActiveAccess(account) && (
    isPlatformAdmin(account) ||
    !!account?.modules.includes(module) ||
    PILOT_OPEN_MODULES.includes(module)
  );
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
    return area ? (!!account?.modules.includes(area) || PILOT_OPEN_MODULES.includes(area)) : false;
  });
}


