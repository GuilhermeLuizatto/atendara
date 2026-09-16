import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoAuthAdapter } from "./demo-adapter";
import { APP_MODULES } from "@/types/access";
import { PLATFORM_ADMIN_EMAIL } from "@/config/access";
import { LEGAL_VERSION } from "@/config/legal";
import { TRIAL_DAYS } from "@/config/platform";

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
    // Sem concessao inicial a conta nasce pendente, como no backend.
    const pending = await adapter.registerProfessional({ email: "pendente@example.com", displayName: "Profissional pendente", professionId: "PSYCHOLOGIST", modules: [...APP_MODULES] });
    expect((await adapter.listAccounts()).items.find(a => a.userId === pending.userId)).toMatchObject({ subscriptionStatus: "PENDING", accessUntil: null });
    await expect(adapter.registerProfessional({ email: "longo@example.com", displayName: "Prazo longo", professionId: "PSYCHOLOGIST", modules: [...APP_MODULES], initialGrant: { kind: "PILOT", until: "2099-01-01T00:00:00Z", reason: "Piloto combinado com a clinica." } })).rejects.toThrow("máximo");
    const until = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const created = await adapter.registerProfessional({ email: "prof@example.com", displayName: "Profissional teste", professionId: "PSYCHOLOGIST", modules: [...APP_MODULES], initialGrant: { kind: "PILOT", until, reason: "Piloto combinado com a clinica." } });
    const organizationId = (await adapter.listAccounts()).items.find(a => a.userId === created.userId)!.organizationId!;
    await adapter.revokeAccess(organizationId, "Piloto encerrado antes do prazo.");
    expect((await adapter.listAccounts()).items.find(a => a.userId === created.userId)).toMatchObject({ subscriptionStatus: "PENDING", accessUntil: null });
    await adapter.grantAccess({ organizationId, kind: "COURTESY", until, reason: "Cortesia para concluir o teste." });
    expect((await adapter.listAccounts()).items.find(a => a.userId === created.userId)).toMatchObject({ subscriptionStatus: "ACTIVE", accessUntil: until });
    await adapter.signOut();
    await expect(adapter.signIn(PLATFORM_ADMIN_EMAIL, "Temporary-test-password")).rejects.toThrow("incorretos");
    const professional = await adapter.signIn("prof@example.com", created.temporaryPassword);
    expect(professional.access).toMatchObject({ platformRole: "PROFESSIONAL", professionId: "PSYCHOLOGIST", mustChangePassword: true });
    await adapter.completeInitialPassword("Professional-personal-password");
    await expect(adapter.listAccounts()).rejects.toThrow("administrador");
    await expect(adapter.updateAccount(initial.userId, { status: "ACTIVE", modules: [...APP_MODULES] })).rejects.toThrow("administrador");
    await expect(adapter.grantAccess({ organizationId, kind: "COURTESY", until, reason: "Tentativa do proprio profissional." })).rejects.toThrow("administrador");
  });
});

describe("Cadastro aberto na demonstracao", () => {
  const cadastro = (extra: Record<string, unknown> = {}) => ({
    displayName: "Bianca Ferraz", email: "bianca@example.com", password: "senha-de-teste",
    professionId: "AESTHETICS" as const, businessName: "Espaço Lume", acceptedLegalVersion: LEGAL_VERSION, ...extra,
  });

  it("cria a conta sem abrir nada e so o teste abre, uma vez so", async () => {
    const adapter = new DemoAuthAdapter();
    await adapter.registerSelfService(cadastro());
    const entrou = await adapter.signIn("bianca@example.com", "senha-de-teste");
    // A conta nasce pendente, como no backend: quem abre e a concessao.
    expect(entrou.access).toMatchObject({ origin: "SELF_SERVICE", subscriptionStatus: "PENDING", accessUntil: null, mustChangePassword: false });
    expect(entrou.access?.modules).toEqual([...APP_MODULES]);

    const primeiro = await adapter.activateTrial();
    const dias = (Date.parse(primeiro.accessUntil!) - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(TRIAL_DAYS - 1);
    expect(dias).toBeLessThanOrEqual(TRIAL_DAYS);
    // Chamar de novo devolve a mesma data em vez de emendar outro teste.
    expect((await adapter.activateTrial()).accessUntil).toBe(primeiro.accessUntil);
  });

  it("recusa o que a tabela de profissoes recusa, e nao revela e-mail repetido", async () => {
    const adapter = new DemoAuthAdapter();
    await expect(adapter.registerSelfService(cadastro({ councilRegistration: "CRP 06/123456" }))).rejects.toThrow("conselho");
    await expect(adapter.registerSelfService(cadastro({ professionId: "PSYCHOLOGIST" }))).rejects.toThrow("CRP");
    await expect(adapter.registerSelfService(cadastro({ acceptedLegalVersion: "2020-01-01" }))).rejects.toThrow("Termos");

    await adapter.registerSelfService(cadastro());
    // Mesma resposta de um cadastro novo: a tela nunca diz quem ja tem conta.
    await expect(adapter.registerSelfService(cadastro({ password: "outra-senha-aqui" }))).resolves.toBeUndefined();
    await expect(adapter.signIn("bianca@example.com", "outra-senha-aqui")).rejects.toThrow("incorretos");
  });

  it("nao comeca teste em conta que a operadora cadastrou", async () => {
    const adapter = new DemoAuthAdapter();
    await adapter.signIn(PLATFORM_ADMIN_EMAIL, "Temporary-test-password");
    await expect(adapter.activateTrial()).rejects.toThrow("teste");
  });
});
