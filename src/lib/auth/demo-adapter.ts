import type { AuthenticatedUser } from "@/types";
import type { AccessUpdate, ProfessionalRegistration } from "@/types/access";
import { hasActiveAccess, isPlatformAdmin } from "@/config/access";
import { readDemoAccounts, writeDemoAccounts, type DemoAccount } from "./demo-accounts";
import { createTemporaryPassword, passwordDigest, passwordError } from "./passwords";
import { accessUpdateSchema, registrationSchema } from "./registration";
import { AuthError, type AuthAdapter } from "./types";

const SESSION_KEY = "atendo:demo-session:v2";

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
    const replacement = { access: { ...account.access, mustChangePassword: false }, salt, hash: await passwordDigest(password, salt) };
    writeDemoAccounts(readDemoAccounts().map(a => a.access.userId === account.access.userId ? replacement : a));
    this.emit();
  }
  async listAccounts() { this.requireAdmin(); return readDemoAccounts().map(a => a.access); }
  async registerProfessional(input: ProfessionalRegistration) {
    this.requireAdmin();
    const data = registrationSchema.parse(input);
    if (Date.parse(data.accessUntil) <= Date.now()) throw new AuthError("Defina uma validade futura.");
    if (readDemoAccounts().some(a => a.access.email === data.email)) throw new AuthError("Este e-mail ja esta cadastrado.");
    const userId = crypto.randomUUID(), salt = crypto.randomUUID(), temporaryPassword = createTemporaryPassword();
    const hash = await passwordDigest(temporaryPassword, salt);
    this.requireAdmin();
    writeDemoAccounts([...readDemoAccounts(), { salt, hash, access: {
      ...data, userId, organizationId: `org-${userId}`, platformRole: "PROFESSIONAL", status: "ACTIVE",
      subscriptionStatus: "ACTIVE", mustChangePassword: true, createdAt: new Date().toISOString(),
    } }]);
    this.emit();
    return { userId, temporaryPassword };
  }
  async updateAccount(userId: string, input: AccessUpdate) {
    this.requireAdmin();
    const data = accessUpdateSchema.parse(input);
    const accounts = readDemoAccounts();
    const account = accounts.find(a => a.access.userId === userId);
    if (!account || account.access.platformRole !== "PROFESSIONAL") throw new AuthError("Cadastro de profissional nao encontrado.");
    writeDemoAccounts(accounts.map(a => a === account ? { ...a, access: { ...a.access, ...data } } : a));
    this.emit();
  }
}
export const demoAuthAdapter: AuthAdapter = new DemoAuthAdapter();
