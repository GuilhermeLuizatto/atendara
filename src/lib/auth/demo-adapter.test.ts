import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoAuthAdapter } from "./demo-adapter";
import { APP_MODULES } from "@/types/access";
import { PLATFORM_ADMIN_EMAIL } from "@/config/access";

vi.mock("@/config/demo-admin", async () => {
  const { pbkdf2Sync } = await import("node:crypto");
  return { DEMO_ADMIN_VERIFIER: { salt: "test-only", hash: pbkdf2Sync("Temporary-test-password", "test-only", 210000, 32, "sha256").toString("hex") } };
});
beforeEach(() => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
describe("Fluxo de cadastro e senha inicial", () => {
  it("recusa login arbitrario e senha errada do administrador", async () => {
    const adapter = new DemoAuthAdapter();
    await expect(adapter.signIn("desconhecido@example.com", "qualquersenha123")).rejects.toThrow("incorretos");
    await expect(adapter.signIn(PLATFORM_ADMIN_EMAIL, "senha-invalida")).rejects.toThrow("incorretos");
  });
  it("exige troca, cadastra profissional restrito e invalida a senha inicial", async () => {
    const adapter = new DemoAuthAdapter();
    const initial = await adapter.signIn(PLATFORM_ADMIN_EMAIL, "Temporary-test-password");
    expect(initial.access?.mustChangePassword).toBe(true);
    await expect(adapter.listAccounts()).rejects.toThrow("administrador");
    await expect(adapter.completeInitialPassword("Temporary-test-password")).rejects.toThrow("diferente");
    await adapter.completeInitialPassword("Personal-test-password");
    const created = await adapter.registerProfessional({ email: "prof@example.com", displayName: "Profissional teste", professionId: "PSYCHOLOGIST", modules: [...APP_MODULES], accessUntil: "2099-01-01T00:00:00Z" });
    await adapter.signOut();
    await expect(adapter.signIn(PLATFORM_ADMIN_EMAIL, "Temporary-test-password")).rejects.toThrow("incorretos");
    const professional = await adapter.signIn("prof@example.com", created.temporaryPassword);
    expect(professional.access).toMatchObject({ platformRole: "PROFESSIONAL", professionId: "PSYCHOLOGIST", mustChangePassword: true });
    await adapter.completeInitialPassword("Professional-personal-password");
    await expect(adapter.listAccounts()).rejects.toThrow("administrador");
    await expect(adapter.updateAccount(initial.userId, { status: "ACTIVE", subscriptionStatus: "ACTIVE", accessUntil: null, modules: [...APP_MODULES] })).rejects.toThrow("administrador");
  });
});
