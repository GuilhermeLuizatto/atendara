import { describe, expect, it } from "vitest";
import { accountPermissions, canAccessModule, canAccessProfession, hasActiveAccess, isPlatformAdmin, PLATFORM_ADMIN_EMAIL } from "./access";
import { APP_MODULES, type AccountAccess } from "@/types/access";
import { permissionsForMembership } from "./permissions";
import { ROLES } from "@/types/professional";

/**
 * Recursos que ficam de fora da sessao DE PROPOSITO: nao tem tela no painel, e
 * o que nao tem tela nao precisa estar liberado no navegador. O backend confere
 * esses por `permissionsForMembership`, sem passar por aqui.
 *
 * Quem construir a tela tira o recurso daqui e o liga a uma area em
 * `PERMISSION_MODULE` — as duas listas juntas tem de cobrir tudo.
 */
const OUT_OF_SESSION_RESOURCES = [
  "member",
  "billing",
  "privacy",
  "platformAdmin",
  // As ações de reenvio e chave de emergência ainda não têm controles na tela.
  "automationTask",
  "automationSwitch",
];
const account: AccountAccess = { userId: "user", email: PLATFORM_ADMIN_EMAIL, displayName: "Teste", platformRole: "PROFESSIONAL", professionId: "PSYCHOLOGIST", organizationId: "org-a", modules: [...APP_MODULES], status: "ACTIVE", subscriptionStatus: "ACTIVE", accessUntil: "2099-01-01T00:00:00Z", mustChangePassword: false, createdAt: "2026-01-01T00:00:00Z" };
describe("Acesso por cadastro", () => {
  it("fila acompanha módulo de agenda e papel, sem liberar escrita", () => {
    for (const role of ROLES) {
      const permissions = accountPermissions(account, { role, isOrganizationHolder: false });
      expect(permissions.includes("automationQueue:read")).toBe(["OWNER", "ADMIN", "PROFESSIONAL"].includes(role));
      expect(permissions).not.toContain("automationTask:retry");
    }
    expect(accountPermissions({ ...account, modules: ["configuracoes"] })).not.toContain("automationQueue:read");
  });
  it("nao concede administracao pelo email", () => expect(isPlatformAdmin(account)).toBe(false));
  it("restringe o profissional a profissao liberada", () => {
    expect(canAccessProfession(account, "PSYCHOLOGIST")).toBe(true);
    expect(canAccessProfession(account, "DENTIST")).toBe(false);
  });
  it.each([{ mustChangePassword: true }, { status: "SUSPENDED" as const }, { subscriptionStatus: "PENDING" as const }, { accessUntil: "2020-01-01T00:00:00Z" }, { accessUntil: null }])("nega acesso sem os requisitos: %j", patch => {
    expect(hasActiveAccess({ ...account, ...patch })).toBe(false);
    expect(accountPermissions({ ...account, ...patch })).toEqual([]);
  });
  it("nega modulo removido e suas operacoes", () => {
    const restricted = { ...account, modules: ["agenda" as const] };
    expect(canAccessModule(restricted, "financeiro")).toBe(false);
    expect(accountPermissions(restricted)).toContain("appointment:update");
    expect(accountPermissions(restricted)).not.toContain("transaction:update");
  });
  it("deriva a sessao do vinculo e da titularidade, dentro dos modulos liberados", () => {
    const holder = { role: "PROFESSIONAL" as const, isOrganizationHolder: true };
    expect(accountPermissions(account)).not.toContain("notificationSettings:update");
    expect(accountPermissions(account, holder)).toContain("notificationSettings:update");
    // Ser titular nao abre a trilha: essa continua de OWNER e ADMIN.
    expect(accountPermissions(account, holder)).not.toContain("auditLog:read");
    expect(accountPermissions(account, { role: "ADMIN", isOrganizationHolder: false })).toContain("auditLog:read");
    const withoutSettings = { ...account, modules: account.modules.filter(area => area !== "configuracoes") };
    const owner = { role: "OWNER" as const, isOrganizationHolder: true };
    expect(accountPermissions(withoutSettings, owner)).not.toContain("auditLog:read");
    expect(accountPermissions(withoutSettings, owner)).not.toContain("notificationSettings:update");
  });
  // O catalogo (E2.1) vive na agenda: sem esse vinculo a permissao some no
  // filtro de modulos e a aba nunca aparece, mesmo com o papel certo.
  it("liga o catalogo de servicos ao modulo da agenda", () => {
    const comAgenda = { ...account, modules: ["agenda" as const] };
    expect(accountPermissions(comAgenda)).toContain("service:read");
    expect(accountPermissions(comAgenda, { role: "PROFESSIONAL", isOrganizationHolder: false })).toContain("service:manage");
    const semAgenda = { ...account, modules: account.modules.filter(area => area !== "agenda") };
    expect(accountPermissions(semAgenda)).not.toContain("service:read");
  });
  // O defeito que isto tranca: recurso sem area em PERMISSION_MODULE some da
  // sessao sem erro nenhum, e a tela que depende dele simplesmente nao aparece.
  it("nenhuma permissao do papel some do caminho sem estar na lista do que fica de fora", () => {
    for (const role of ROLES) {
      for (const titular of [false, true]) {
        const concedidas = permissionsForMembership(role, titular);
        const naSessao = accountPermissions(account, { role, isOrganizationHolder: titular });
        const sumiram = concedidas
          .filter(permission => !naSessao.includes(permission))
          .filter(permission => !OUT_OF_SESSION_RESOURCES.includes(permission.split(":")[0]));

        expect({ role, titular, sumiram }).toEqual({ role, titular, sumiram: [] });
      }
    }
  });

  it("registrar consentimento chega a quem cuida do cadastro", () => {
    expect(accountPermissions(account, { role: "ASSISTANT", isOrganizationHolder: false })).toContain(
      "notificationConsent:record",
    );
    const semClientes = { ...account, modules: account.modules.filter(area => area !== "clientes") };
    expect(accountPermissions(semClientes, { role: "OWNER", isOrganizationHolder: true })).not.toContain(
      "notificationConsent:record",
    );
  });

  it("admin acessa todas as profissoes depois da troca de senha", () => {
    const admin = { ...account, platformRole: "PLATFORM_ADMIN" as const, accessUntil: null, modules: [] };
    expect(canAccessProfession(admin, "DENTIST")).toBe(true);
    expect(canAccessProfession({ ...admin, mustChangePassword: true }, "DENTIST")).toBe(false);
  });
});
