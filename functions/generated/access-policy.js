// Gerado por scripts/build-functions.mjs.
import { permissionsForMembership, permissionsForRole } from "./permissions.js";
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
export const MODULE_LABELS = {
    dashboard: "Dashboard", agenda: "Agenda", clientes: "Clientes", mensagens: "Mensagens",
    financeiro: "Financeiro", agente: "Dara", configuracoes: "Configurações",
};
/**
 * Area do painel de cada recurso.
 *
 * Permissao cujo recurso nao esta aqui **some da sessao em silencio** — e o que
 * aconteceu com `notificationConsent:record`, que tem tela e trava de escrita
 * desde sempre e mesmo assim nunca chegava a ninguem. A lista do que fica de
 * fora de proposito vive em `OUT_OF_SESSION_RESOURCES`, no teste: recurso
 * novo que nao entre em nenhuma das duas derruba a suite, em vez de sumir.
 */
const PERMISSION_MODULE = {
    appointment: "agenda", service: "agenda", client: "clientes", conversation: "mensagens", transaction: "financeiro",
    rule: "agente", aiDecision: "agente", notification: "dashboard", organization: "dashboard",
    notificationSettings: "configuracoes", agendaSettings: "dashboard", auditLog: "configuracoes",
    // Registrado na ficha do cadastro, pela mesma tela que cria e edita o
    // cadastro. Sem isto, ninguem consegue registrar consentimento — e sem
    // consentimento nenhum aviso pode sair (regra 11).
    notificationConsent: "clientes",
    automationQueue: "agenda",
};
const UNRESOLVED_MEMBERSHIP = { role: "PROFESSIONAL", isOrganizationHolder: false };
export function isPlatformAdmin(account) {
    return account?.platformRole === "PLATFORM_ADMIN" && account.status === "ACTIVE";
}
export function hasActiveAccess(account, now = new Date()) {
    if (!account || account.mustChangePassword || account.status !== "ACTIVE")
        return false;
    if (isPlatformAdmin(account))
        return true;
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
export function canManageSubscription(account) {
    return !!account && account.status === "ACTIVE" && !account.mustChangePassword &&
        account.platformRole === "PROFESSIONAL" && !!account.organizationId;
}
export function canAccessProfession(account, profession) {
    return hasActiveAccess(account) && (isPlatformAdmin(account) || account?.professionId === profession);
}
export function canAccessModule(account, module) {
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
export function accountPermissions(account, membership = UNRESOLVED_MEMBERSHIP) {
    if (!hasActiveAccess(account))
        return [];
    if (isPlatformAdmin(account))
        return permissionsForRole("OWNER");
    return permissionsForMembership(membership.role, membership.isOrganizationHolder).filter((permission) => {
        const area = PERMISSION_MODULE[permission.split(":")[0]];
        return area ? !!account?.modules.includes(area) : false;
    });
}
