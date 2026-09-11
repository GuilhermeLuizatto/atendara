import type { AuthenticatedUser, Page, PageRequest } from "@/types";
import type { AccessGrantInput } from "@/types/platform";

export type AuthMode = "firebase" | "demo";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Senha conferida, falta o codigo do aplicativo autenticador. O adaptador
 * guarda o desafio; a tela so pede o codigo.
 */
export class SecondFactorRequiredError extends AuthError {
  constructor() {
    super("Digite o codigo de 6 digitos do seu aplicativo autenticador.");
    this.name = "SecondFactorRequiredError";
  }
}

/**
 * Onde a sessao esta em relacao ao segundo fator exigido da operadora.
 *
 * - `not-applicable`: conta que nao precisa (profissional) ou modo demonstracao;
 * - `satisfied`: a sessao entrou com o fator aceito pelas regras;
 * - `verify-email`: o Identity Platform exige e-mail verificado antes de cadastrar fator;
 * - `enroll`: sem fator cadastrado;
 * - `sign-in-again`: fator cadastrado, mas esta sessao entrou sem ele.
 */
export type SecondFactorState = "not-applicable" | "satisfied" | "verify-email" | "enroll" | "sign-in-again";

export interface TotpEnrollment {
  /** Chave para digitar no aplicativo quando nao da para ler o codigo. */
  secretKey: string;
  /** `otpauth://` para o aplicativo autenticador. */
  uri: string;
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
  /** Lanca `SecondFactorRequiredError` quando a conta tem segundo fator cadastrado. */
  signIn(email: string, password: string): Promise<AuthenticatedUser>;
  completeSecondFactorSignIn(code: string): Promise<AuthenticatedUser>;
  signOut(): Promise<void>;
  completeInitialPassword(password: string): Promise<void>;
  /**
   * Envia o link de nova senha. Resolve igual exista a conta ou nao: dizer
   * "e-mail nao cadastrado" entregaria a lista de clientes a quem testar.
   */
  sendPasswordReset(email: string): Promise<void>;
  /** Confere o codigo do link e devolve o e-mail da conta. */
  verifyPasswordReset(code: string): Promise<string>;
  confirmPasswordReset(code: string, password: string): Promise<void>;
  secondFactorState(): Promise<SecondFactorState>;
  sendEmailVerification(): Promise<void>;
  startTotpEnrollment(): Promise<TotpEnrollment>;
  finishTotpEnrollment(code: string): Promise<void>;
  /** Cadastros em ordem de e-mail, uma pagina por vez. */
  listAccounts(request?: PageRequest): Promise<Page<import("@/types/access").AccountAccess>>;
  /** Contas citadas numa pagina de outra listagem, sem varrer todas. */
  accountsById(userIds: string[]): Promise<import("@/types/access").AccountAccess[]>;
  registerProfessional(input: import("@/types/access").ProfessionalRegistration): Promise<{ userId: string; temporaryPassword: string }>;
  updateAccount(userId: string, input: import("@/types/access").AccessUpdate): Promise<void>;
  grantAccess(input: AccessGrantInput): Promise<void>;
  revokeAccess(organizationId: string, reason: string): Promise<void>;
}
