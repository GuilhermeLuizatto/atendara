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
    super("Digite o código de 6 dígitos do seu aplicativo autenticador.");
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
  /**
   * Entrada pelo Google. E so a PRIMEIRA etapa do cadastro aberto: o Google
   * entrega nome e e-mail ja confirmados, e a segunda tela ainda precisa
   * perguntar profissao, conselho e nome do negocio. Sem ela nao ha
   * organizacao, e sem organizacao nao ha painel.
   */
  signInWithGoogle(): Promise<AuthenticatedUser>;
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
  /**
   * Relê a sessao e o cadastro, forcando token novo.
   *
   * `email_verified` viaja no token: sem renovar, quem acabou de confirmar o
   * e-mail continuaria sendo recusado pela callable que comeca o teste.
   */
  refreshSession(): Promise<AuthenticatedUser | null>;
  /**
   * Cadastro aberto. Nao devolve nada de proposito: a resposta e a mesma para
   * e-mail novo e para e-mail ja cadastrado, e a tela nunca fica sabendo qual
   * dos dois aconteceu.
   */
  registerSelfService(input: import("@/types/access").SelfServiceRegistration): Promise<void>;
  /** Comeca o teste de 14 dias depois do e-mail confirmado. Idempotente. */
  activateTrial(): Promise<{ accessUntil: string | null }>;
  startTotpEnrollment(): Promise<TotpEnrollment>;
  finishTotpEnrollment(code: string): Promise<void>;
  /** Cadastros em ordem de e-mail, uma pagina por vez. */
  listAccounts(request?: PageRequest): Promise<Page<import("@/types/access").AccountAccess>>;
  /** Contas citadas numa pagina de outra listagem, sem varrer todas. */
  accountsById(userIds: string[]): Promise<import("@/types/access").AccountAccess[]>;
  registerProfessional(input: import("@/types/access").ProfessionalRegistration): Promise<{ userId: string; temporaryPassword: string }>;
  updateAccount(userId: string, input: import("@/types/access").AccessUpdate): Promise<void>;
  grantAccess(input: AccessGrantInput): Promise<void>;
  /**
   * O titular pede para mudar de profissao. So pede: enquanto a operadora nao
   * decidir, a profissao continua a mesma.
   */
  requestProfessionChange(professionId: import("@/types").ProfessionId, reason: string): Promise<void>;
  /** A operadora responde. Aprovar muda conta, organizacao e perfil de uma vez. */
  decideProfessionChange(organizationId: string, decision: "APPROVED" | "REJECTED", reason: string): Promise<void>;
  revokeAccess(organizationId: string, reason: string): Promise<void>;
  /** So a chave mestra. O novo administrador troca a senha e cadastra o segundo fator no primeiro acesso. */
  createPlatformAdmin(input: import("@/types/access").PlatformAdminRegistration): Promise<{ userId: string; temporaryPassword: string }>;
  setPlatformAdminStatus(userId: string, status: import("@/types/access").AccountAccess["status"]): Promise<void>;
}
