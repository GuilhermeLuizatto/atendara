import type { AuthenticatedUser } from "@/types";

export type AuthMode = "firebase" | "demo";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Contrato de autenticacao.
 *
 * A aplicacao inteira depende desta interface, nunca do SDK do Firebase
 * diretamente. Isso permite (a) rodar o prototipo sem projeto configurado e
 * (b) testar fluxos de sessao sem emulador.
 */
export interface AuthAdapter {
  readonly mode: AuthMode;
  /** Notifica o estado atual imediatamente e a cada mudanca. Devolve o unsubscribe. */
  subscribe(listener: (user: AuthenticatedUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthenticatedUser>;
  signOut(): Promise<void>;
  completeInitialPassword(password: string): Promise<void>;
  listAccounts(): Promise<import("@/types/access").AccountAccess[]>;
  registerProfessional(input: import("@/types/access").ProfessionalRegistration): Promise<{ userId: string; temporaryPassword: string }>;
  updateAccount(userId: string, input: import("@/types/access").AccessUpdate): Promise<void>;
}
