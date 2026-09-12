import type { AuthenticatedUser, Page, PageCursor, PageRequest } from "@/types";
import { APP_MODULES } from "@/types/access";
import type { AccessUpdate, AccountAccess, PlatformAdminRegistration, ProfessionalRegistration } from "@/types/access";
import type { AccessGrantInput } from "@/types/platform";
import { hasActiveAccess, isPlatformAdmin } from "@/config/access";
import { accessGrantReasonError, accessGrantWindowError, isGrantInForce, resolveAccountGate } from "@/lib/platform/access-gate";
import { readDemoAccounts, writeDemoAccounts, type DemoAccount } from "./demo-accounts";
import { createTemporaryPassword, passwordDigest, passwordError } from "./passwords";
import { accessGrantSchema, accessUpdateSchema, platformAdminRegistrationSchema, registrationSchema } from "./registration";
import { AuthError, type AuthAdapter, type SecondFactorState, type TotpEnrollment } from "./types";

const SESSION_KEY = "atendo:demo-session:v2";
const DEMO_PAGE_SIZE = 25;
const NO_SECOND_FACTOR = "A demonstração local não simula segundo fator.";
// A demonstracao nao envia e-mail. O caminho equivalente e o administrador
// gerar um novo cadastro, que ja nasce com senha inicial.
const NO_PASSWORD_EMAIL = "A demonstração local não envia e-mail. Peça ao administrador um novo cadastro com senha inicial.";

function assertGrant(until: string, reason: string) {
  const error = accessGrantWindowError(until, Date.now()) ?? accessGrantReasonError(reason);
  if (error) throw new AuthError(error);
}

// Esta simulacao local valida os fluxos de interface; a seguranca real pertence ao Firebase.
export class DemoAuthAdapter implements AuthAdapter {
  readonly mode = "demo" as const;
  private listeners = new Set<(user: AuthenticatedUser | null) => void>();
  private current(): DemoAccount | undefined {
    if (typeof window === "undefined") return undefined;
    return readDemoAccounts().find(a => a.access.userId === localStorage.getItem(SESSION_KEY));
  }
  private user(): AuthenticatedUser | null {
    const account = this.current();
    return account ? { ...account.access, avatarUrl: null, access: account.access } : null;
  }
  private emit = () => { for (const listener of this.listeners) listener(this.user()); };
  subscribe(listener: (user: AuthenticatedUser | null) => void) {
    this.listeners.add(listener);
    listener(this.user());
    if (typeof window !== "undefined") window.addEventListener("storage", this.emit);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && typeof window !== "undefined") window.removeEventListener("storage", this.emit);
    };
  }
  async signIn(email: string, password: string): Promise<AuthenticatedUser> {
    const accounts = readDemoAccounts();
    const account = accounts.find(a => a.access.email === email.trim().toLowerCase());
    if (!account || await passwordDigest(password, account.salt) !== account.hash) throw new AuthError("E-mail ou senha incorretos.");
    writeDemoAccounts(accounts);
    localStorage.setItem(SESSION_KEY, account.access.userId);
    this.emit();
    return this.user()!;
  }
  async completeSecondFactorSignIn(): Promise<AuthenticatedUser> { throw new AuthError(NO_SECOND_FACTOR); }
  async signOut() { localStorage.removeItem(SESSION_KEY); this.emit(); }
  private requireAdmin() {
    const access = this.current()?.access;
    if (!isPlatformAdmin(access) || !hasActiveAccess(access)) throw new AuthError("Apenas o administrador pode gerenciar acessos.");
  }
  async completeInitialPassword(password: string) {
    const account = this.current();
    if (!account || !account.access.mustChangePassword) throw new AuthError("Entre com sua senha inicial.");
    const error = passwordError(password);
    if (error) throw new AuthError(error);
    if (await passwordDigest(password, account.salt) === account.hash) throw new AuthError("Escolha uma senha diferente da inicial.");
    const salt = crypto.randomUUID();
    const replacement = { ...account, access: { ...account.access, mustChangePassword: false }, salt, hash: await passwordDigest(password, salt) };
    writeDemoAccounts(readDemoAccounts().map(a => a.access.userId === account.access.userId ? replacement : a));
    this.emit();
  }
  async sendPasswordReset(): Promise<void> { throw new AuthError(NO_PASSWORD_EMAIL); }
  async verifyPasswordReset(): Promise<string> { throw new AuthError(NO_PASSWORD_EMAIL); }
  async confirmPasswordReset(): Promise<void> { throw new AuthError(NO_PASSWORD_EMAIL); }
  async secondFactorState(): Promise<SecondFactorState> { return "not-applicable"; }
  async sendEmailVerification() { throw new AuthError(NO_SECOND_FACTOR); }
  async startTotpEnrollment(): Promise<TotpEnrollment> { throw new AuthError(NO_SECOND_FACTOR); }
  async finishTotpEnrollment() { throw new AuthError(NO_SECOND_FACTOR); }
  async listAccounts(request: PageRequest = {}): Promise<Page<AccountAccess>> {
    this.requireAdmin();
    const all = readDemoAccounts().map(a => a.access).sort((a, b) => a.email.localeCompare(b.email));
    const offset = (request.cursor as unknown as { offset?: number } | null)?.offset ?? 0;
    const size = request.size ?? DEMO_PAGE_SIZE;
    const end = offset + size;
    return { items: all.slice(offset, end), next: end < all.length ? ({ offset: end } as unknown as PageCursor) : null };
  }
  async accountsById(userIds: string[]) {
    this.requireAdmin();
    return readDemoAccounts().map(a => a.access).filter(access => userIds.includes(access.userId));
  }
  async registerProfessional(input: ProfessionalRegistration) {
    this.requireAdmin();
    const { initialGrant, ...data } = registrationSchema.parse(input);
    if (initialGrant) assertGrant(initialGrant.until, initialGrant.reason);
    if (readDemoAccounts().some(a => a.access.email === data.email)) throw new AuthError("Este e-mail já está cadastrado.");
    const userId = crypto.randomUUID(), salt = crypto.randomUUID(), temporaryPassword = createTemporaryPassword();
    const hash = await passwordDigest(temporaryPassword, salt);
    this.requireAdmin();
    // Mesma regra do backend: a conta nasce pendente; so a concessao abre.
    const grant = initialGrant ? { ...initialGrant, until: new Date(initialGrant.until).toISOString(), revokedAt: null } : undefined;
    const gate = resolveAccountGate({ subscription: null, grant, nowMs: Date.now() });
    writeDemoAccounts([...readDemoAccounts(), { salt, hash, grant, access: {
      ...data, userId, organizationId: `org-${userId}`, platformRole: "PROFESSIONAL", status: "ACTIVE",
      subscriptionStatus: gate.subscriptionStatus, accessUntil: gate.accessUntil, mustChangePassword: true, createdAt: new Date().toISOString(),
    } }]);
    this.emit();
    return { userId, temporaryPassword };
  }
  async updateAccount(userId: string, input: AccessUpdate) {
    this.requireAdmin();
    const data = accessUpdateSchema.parse(input);
    const accounts = readDemoAccounts();
    const account = accounts.find(a => a.access.userId === userId);
    if (!account || account.access.platformRole !== "PROFESSIONAL") throw new AuthError("Cadastro de profissional não encontrado.");
    writeDemoAccounts(accounts.map(a => a === account ? { ...a, access: { ...a.access, ...data } } : a));
    this.emit();
  }
  private titularOf(organizationId: string): DemoAccount {
    const account = readDemoAccounts().find(a => a.access.organizationId === organizationId && a.access.platformRole === "PROFESSIONAL");
    if (!account) throw new AuthError("Organização sem titular profissional.");
    return account;
  }
  private replace(account: DemoAccount) {
    writeDemoAccounts(readDemoAccounts().map(a => a.access.userId === account.access.userId ? account : a));
    this.emit();
  }
  async grantAccess(input: AccessGrantInput) {
    this.requireAdmin();
    const data = accessGrantSchema.parse(input);
    assertGrant(data.until, data.reason);
    const account = this.titularOf(data.organizationId);
    const grant = { kind: data.kind, reason: data.reason, until: new Date(data.until).toISOString(), revokedAt: null };
    const gate = resolveAccountGate({ subscription: null, grant, nowMs: Date.now() });
    this.replace({ ...account, grant, access: { ...account.access, ...gate } });
  }
  async revokeAccess(organizationId: string, reason: string) {
    this.requireAdmin();
    const reasonError = accessGrantReasonError(reason);
    if (reasonError) throw new AuthError(reasonError);
    const account = this.titularOf(organizationId);
    if (!account.grant || !isGrantInForce(account.grant, Date.now())) throw new AuthError("Não há concessão vigente para esta organização.");
    const gate = resolveAccountGate({ subscription: null, grant: null, nowMs: Date.now() });
    this.replace({ ...account, grant: { ...account.grant, revokedAt: new Date().toISOString() }, access: { ...account.access, ...gate } });
  }
  private requireMaster() {
    this.requireAdmin();
    if (this.current()?.access.platformMaster !== true) throw new AuthError("Somente a chave mestra gerencia administradores.");
  }
  async createPlatformAdmin(input: PlatformAdminRegistration) {
    this.requireMaster();
    const data = platformAdminRegistrationSchema.parse(input);
    if (readDemoAccounts().some(a => a.access.email === data.email)) throw new AuthError("Este e-mail já está cadastrado.");
    const userId = crypto.randomUUID(), salt = crypto.randomUUID(), temporaryPassword = createTemporaryPassword();
    const hash = await passwordDigest(temporaryPassword, salt);
    writeDemoAccounts([...readDemoAccounts(), { salt, hash, access: {
      ...data, userId, platformRole: "PLATFORM_ADMIN", platformMaster: false, organizationId: null, professionId: null,
      modules: [...APP_MODULES], status: "ACTIVE", subscriptionStatus: "ACTIVE", accessUntil: null, mustChangePassword: true,
      createdAt: new Date().toISOString(),
    } }]);
    this.emit();
    return { userId, temporaryPassword };
  }
  async setPlatformAdminStatus(userId: string, status: AccountAccess["status"]) {
    this.requireMaster();
    if (userId === this.current()?.access.userId) throw new AuthError("A chave mestra não altera a própria conta por aqui.");
    const account = readDemoAccounts().find(a => a.access.userId === userId);
    if (!account || account.access.platformRole !== "PLATFORM_ADMIN") throw new AuthError("Administrador não encontrado.");
    if (account.access.platformMaster === true) throw new AuthError("Chave mestra não é suspensa por aqui.");
    this.replace({ ...account, access: { ...account.access, status } });
  }
}
export const demoAuthAdapter: AuthAdapter = new DemoAuthAdapter();
