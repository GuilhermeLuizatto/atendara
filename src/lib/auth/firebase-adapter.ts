import {
  TotpMultiFactorGenerator,
  confirmPasswordReset as confirmFirebasePasswordReset,
  getMultiFactorResolver,
  multiFactor,
  onAuthStateChanged,
  sendEmailVerification as sendVerificationEmail,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  verifyPasswordResetCode,
  signOut as firebaseSignOut,
  type MultiFactorError,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from "firebase/auth";

import { APP_NAME } from "@/config/app";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { getDb, getFirebaseApp } from "@/lib/firebase/client";
import { doc, getDoc, onSnapshot, collection, orderBy, query } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { readPage } from "@/lib/firebase/paging";
import { paths } from "@/lib/firebase/paths";
import { hasRequiredSecondFactor } from "@/lib/platform/access-gate";
import { passwordError } from "./passwords";
import type { AccountAccess, AccessUpdate, PlatformAdminRegistration, ProfessionalRegistration } from "@/types/access";
import type { AccessGrantInput } from "@/types/platform";
import type { AuthenticatedUser, Page, PageRequest } from "@/types";

import { AuthError, SecondFactorRequiredError, type AuthAdapter, type SecondFactorState, type TotpEnrollment } from "./types";

const REGION = "southamerica-east1";
const ACCOUNTS_PAGE_SIZE = 25;

function callable<Input, Output>(name: string) {
  return httpsCallable<Input, Output>(getFunctions(getFirebaseApp(), REGION), name);
}

function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    userId: user.uid,
    email: user.email ?? "",
    displayName: user.displayName ?? user.email?.split("@")[0] ?? "Usuario",
    avatarUrl: user.photoURL,
  };
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
}

/** Mensagens de erro do Firebase traduzidas, sem vazar detalhe interno. */
function translate(code: unknown, fallback = "Nao foi possivel entrar. Tente novamente."): string {
  const errorCode = typeof code === "string" ? code : "";
  switch (errorCode) {
    case "auth/invalid-email":
    case "auth/missing-email":
      return "Informe um e-mail valido.";
    case "auth/expired-action-code":
      return "Este link venceu. Peca um novo na tela de entrada, em Esqueci minha senha.";
    case "auth/invalid-action-code":
      return "Este link ja foi usado ou esta incompleto. Peca um novo na tela de entrada, em Esqueci minha senha.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Escolha uma senha mais forte, de 12 a 128 caracteres.";
    case "auth/user-disabled":
      return "Esta conta esta desativada.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "E-mail ou senha incorretos.";
    case "auth/too-many-requests":
      return "Muitas tentativas. Aguarde alguns minutos.";
    case "auth/network-request-failed":
      return "Falha de conexao. Verifique sua internet.";
    case "auth/invalid-verification-code":
      return "Codigo incorreto ou vencido. Confira o aplicativo e tente de novo.";
    case "auth/unverified-email":
      return "Confirme o e-mail da conta antes de cadastrar o segundo fator.";
    case "auth/requires-recent-login":
      return "Entre novamente para cadastrar o segundo fator.";
    case "auth/operation-not-allowed":
      return "O segundo fator ainda nao esta habilitado neste projeto.";
    default:
      return fallback;
  }
}

/** URL de retorno recusada porque o dominio nao esta autorizado no projeto. */
const CONTINUE_URL_REFUSED = new Set(["auth/unauthorized-continue-uri", "auth/invalid-continue-uri"]);

class FirebaseAuthAdapter implements AuthAdapter {
  readonly mode = "firebase" as const;
  /** Desafio da entrada em duas etapas, entre a senha e o codigo. */
  private resolver: MultiFactorResolver | null = null;
  /** Segredo gerado para cadastro, ate o primeiro codigo confirmar. */
  private pendingSecret: TotpSecret | null = null;

  subscribe(listener: (user: AuthenticatedUser | null) => void): () => void {
    let unsubscribeProfile = () => {};
    const unsubscribeAuth = onAuthStateChanged(getFirebaseAuth(), (user) => {
      unsubscribeProfile();
      if (!user) { listener(null); return; }
      unsubscribeProfile = onSnapshot(doc(getDb(), paths.account(user.uid)), snapshot => {
        listener({ ...toAuthenticatedUser(user), access: snapshot.exists() ? snapshot.data() as AccountAccess : null });
      }, () => listener({ ...toAuthenticatedUser(user), access: null }));
    });
    return () => { unsubscribeAuth(); unsubscribeProfile(); };
  }

  private async withProfile(user: User): Promise<AuthenticatedUser> {
    const profile = await getDoc(doc(getDb(), paths.account(user.uid)));
    return { ...toAuthenticatedUser(user), access: profile.exists() ? profile.data() as AccountAccess : null };
  }

  private currentUser(): User {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new AuthError("Entre na sua conta.");
    return user;
  }

  async signIn(email: string, password: string): Promise<AuthenticatedUser> {
    this.resolver = null;
    try {
      const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      return await this.withProfile(credential.user);
    } catch (error) {
      if (errorCode(error) === "auth/multi-factor-auth-required") {
        this.resolver = getMultiFactorResolver(getFirebaseAuth(), error as MultiFactorError);
        throw new SecondFactorRequiredError();
      }
      throw new AuthError(translate(errorCode(error)));
    }
  }

  async completeSecondFactorSignIn(code: string): Promise<AuthenticatedUser> {
    const resolver = this.resolver;
    const hint = resolver?.hints.find(item => item.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (!resolver || !hint) throw new AuthError("Entre com e-mail e senha antes do codigo.");
    try {
      const credential = await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim()));
      this.resolver = null;
      return await this.withProfile(credential.user);
    } catch (error) {
      throw new AuthError(translate(errorCode(error)));
    }
  }

  async signOut(): Promise<void> {
    this.resolver = null;
    this.pendingSecret = null;
    await firebaseSignOut(getFirebaseAuth());
  }

  async completeInitialPassword(password: string): Promise<void> {
    await callable<{ password: string }, { ok: boolean }>("completeInitialPassword")({ password });
    await getFirebaseAuth().currentUser?.getIdToken(true);
  }

  /**
   * O link aponta para a acao de e-mail do projeto; com o modelo apontado para
   * `/redefinir-senha/`, abre a tela do Atendara, e sem isso a pagina padrao do
   * Firebase faz o mesmo. `auth/user-not-found` e tratado como sucesso: a
   * resposta nao pode revelar se o e-mail tem conta.
   */
  async sendPasswordReset(email: string): Promise<void> {
    const auth = getFirebaseAuth();
    auth.languageCode = "pt-BR";
    const address = email.trim();
    try {
      try {
        await sendPasswordResetEmail(auth, address, { url: `${window.location.origin}/login/` });
      } catch (error) {
        if (!CONTINUE_URL_REFUSED.has(errorCode(error))) throw error;
        await sendPasswordResetEmail(auth, address);
      }
    } catch (error) {
      if (errorCode(error) === "auth/user-not-found") return;
      throw new AuthError(translate(errorCode(error), "Nao foi possivel enviar o link agora. Tente novamente."));
    }
  }

  async verifyPasswordReset(code: string): Promise<string> {
    try {
      return await verifyPasswordResetCode(getFirebaseAuth(), code);
    } catch (error) {
      throw new AuthError(translate(errorCode(error), "Nao foi possivel conferir este link. Tente novamente."));
    }
  }

  async confirmPasswordReset(code: string, password: string): Promise<void> {
    const invalid = passwordError(password);
    if (invalid) throw new AuthError(invalid);
    try {
      await confirmFirebasePasswordReset(getFirebaseAuth(), code, password);
    } catch (error) {
      throw new AuthError(translate(errorCode(error), "Nao foi possivel salvar a nova senha. Tente novamente."));
    }
  }

  /**
   * Decide pela conta e pelo TOKEN da sessao, que e o mesmo claim que regras e
   * callables conferem. Estado de interface: a recusa de verdade e do servidor.
   */
  async secondFactorState(): Promise<SecondFactorState> {
    const user = getFirebaseAuth().currentUser;
    if (!user) return "not-applicable";
    const profile = await getDoc(doc(getDb(), paths.account(user.uid)));
    if (profile.data()?.platformRole !== "PLATFORM_ADMIN") return "not-applicable";
    const token = await user.getIdTokenResult();
    if (hasRequiredSecondFactor(token.claims)) return "satisfied";
    await user.reload();
    if (!user.emailVerified) return "verify-email";
    const enrolled = multiFactor(user).enrolledFactors.some(factor => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    return enrolled ? "sign-in-again" : "enroll";
  }

  async sendEmailVerification(): Promise<void> {
    try { await sendVerificationEmail(this.currentUser()); }
    catch (error) { throw new AuthError(translate(errorCode(error))); }
  }

  async startTotpEnrollment(): Promise<TotpEnrollment> {
    const user = this.currentUser();
    try {
      const session = await multiFactor(user).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      this.pendingSecret = secret;
      return { secretKey: secret.secretKey, uri: secret.generateQrCodeUrl(user.email ?? user.uid, APP_NAME) };
    } catch (error) {
      throw new AuthError(translate(errorCode(error)));
    }
  }

  async finishTotpEnrollment(code: string): Promise<void> {
    const user = this.currentUser();
    const secret = this.pendingSecret;
    if (!secret) throw new AuthError("Gere o segredo antes de confirmar o codigo.");
    try {
      await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim()), "Aplicativo autenticador");
      this.pendingSecret = null;
    } catch (error) {
      throw new AuthError(translate(errorCode(error)));
    }
  }

  async listAccounts(request: PageRequest = {}): Promise<Page<AccountAccess>> {
    return readPage(
      query(collection(getDb(), paths.accounts()), orderBy("email")),
      request,
      ACCOUNTS_PAGE_SIZE,
      document => document.data() as AccountAccess,
    );
  }
  async accountsById(userIds: string[]): Promise<AccountAccess[]> {
    const documents = await Promise.all([...new Set(userIds)].map(userId => getDoc(doc(getDb(), paths.account(userId)))));
    return documents.filter(document => document.exists()).map(document => document.data() as AccountAccess);
  }
  async registerProfessional(input: ProfessionalRegistration): Promise<{ userId: string; temporaryPassword: string }> {
    const result = await callable<ProfessionalRegistration, { userId: string; temporaryPassword: string }>("registerProfessional")(input);
    return result.data;
  }
  async updateAccount(userId: string, input: AccessUpdate): Promise<void> {
    await callable("updateAccount")({ userId, ...input });
  }
  async grantAccess(input: AccessGrantInput): Promise<void> {
    await callable<AccessGrantInput, { ok: boolean }>("grantAccess")(input);
  }
  async revokeAccess(organizationId: string, reason: string): Promise<void> {
    await callable<{ organizationId: string; reason: string }, { ok: boolean }>("revokeAccess")({ organizationId, reason });
  }
  async createPlatformAdmin(input: PlatformAdminRegistration): Promise<{ userId: string; temporaryPassword: string }> {
    const result = await callable<PlatformAdminRegistration, { userId: string; temporaryPassword: string }>("createPlatformAdmin")(input);
    return result.data;
  }
  async setPlatformAdminStatus(userId: string, status: AccountAccess["status"]): Promise<void> {
    await callable<{ userId: string; status: AccountAccess["status"] }, { ok: boolean }>("setPlatformAdminStatus")({ userId, status });
  }
}

export const firebaseAuthAdapter: AuthAdapter = new FirebaseAuthAdapter();
