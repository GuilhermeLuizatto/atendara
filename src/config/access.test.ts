import { describe, expect, it } from "vitest";
import { accountPermissions, canAccessModule, canAccessProfession, hasActiveAccess, isPlatformAdmin, PLATFORM_ADMIN_EMAIL } from "./access";
import { APP_MODULES, type AccountAccess } from "@/types/access";
const account: AccountAccess = { userId: "user", email: PLATFORM_ADMIN_EMAIL, displayName: "Teste", platformRole: "PROFESSIONAL", professionId: "PSYCHOLOGIST", organizationId: "org-a", modules: [...APP_MODULES], status: "ACTIVE", subscriptionStatus: "ACTIVE", accessUntil: "2099-01-01T00:00:00Z", mustChangePassword: false, createdAt: "2026-01-01T00:00:00Z" };
describe("Acesso por cadastro", () => {
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
  it("admin acessa todas as profissoes depois da troca de senha", () => {
    const admin = { ...account, platformRole: "PLATFORM_ADMIN" as const, accessUntil: null, modules: [] };
    expect(canAccessProfession(admin, "DENTIST")).toBe(true);
    expect(canAccessProfession({ ...admin, mustChangePassword: true }, "DENTIST")).toBe(false);
  });
});
