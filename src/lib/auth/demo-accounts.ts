import { APP_MODULES, type AccountAccess } from "@/types/access";
import type { AccessGrantKind } from "@/types/platform";
import { PLATFORM_ADMIN_EMAIL } from "@/config/access";
import { DEMO_ADMIN_VERIFIER } from "@/config/demo-admin";

export interface DemoAccount {
  access: AccountAccess;
  salt: string;
  hash: string;
  /** Concessao simulada da demonstracao. Sem trilha: nada aqui e registro real. */
  grant?: { kind: AccessGrantKind; reason: string; until: string; revokedAt: string | null };
}
const KEY = "atendo:demo-accounts:v2";

export function readDemoAccounts(): DemoAccount[] {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  if (raw) return JSON.parse(raw) as DemoAccount[];
  if (!DEMO_ADMIN_VERIFIER.salt || !DEMO_ADMIN_VERIFIER.hash) return [];
  return [{ ...DEMO_ADMIN_VERIFIER, access: {
    userId: "demo-platform-admin", email: PLATFORM_ADMIN_EMAIL, displayName: "Guilherme Luizatto",
    platformRole: "PLATFORM_ADMIN", platformMaster: true, organizationId: null, professionId: null, modules: [...APP_MODULES],
    status: "ACTIVE", subscriptionStatus: "ACTIVE", accessUntil: null, mustChangePassword: true,
    createdAt: new Date().toISOString(),
  } }];
}

export function writeDemoAccounts(accounts: DemoAccount[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(accounts));
}
