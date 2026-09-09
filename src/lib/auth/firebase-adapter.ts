import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase/client";
import { getDb, getFirebaseApp } from "@/lib/firebase/client";
import { doc, getDoc, onSnapshot, collection, getDocs } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { paths } from "@/lib/firebase/paths";
import type { AccountAccess, AccessUpdate, ProfessionalRegistration } from "@/types/access";
import type { AuthenticatedUser } from "@/types";

import { AuthError, type AuthAdapter } from "./types";

function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    userId: user.uid,
    email: user.email ?? "",
    displayName: user.displayName ?? user.email?.split("@")[0] ?? "Usuario",
    avatarUrl: user.photoURL,
  };
}

/** Mensagens de erro do Firebase traduzidas, sem vazar detalhe interno. */
function translate(code: unknown): string {
  const errorCode = typeof code === "string" ? code : "";
  switch (errorCode) {
    case "auth/invalid-email":
      return "Informe um e-mail valido.";
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
    default:
      return "Nao foi possivel entrar. Tente novamente.";
  }
}

class FirebaseAuthAdapter implements AuthAdapter {
  readonly mode = "firebase" as const;

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

  async signIn(email: string, password: string): Promise<AuthenticatedUser> {
    try {
      const credential = await signInWithEmailAndPassword(
        getFirebaseAuth(),
        email.trim(),
        password,
      );
      const profile = await getDoc(doc(getDb(), paths.account(credential.user.uid)));
      return { ...toAuthenticatedUser(credential.user), access: profile.exists() ? profile.data() as AccountAccess : null };
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code: unknown }).code
          : undefined;
      throw new AuthError(translate(code));
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(getFirebaseAuth());
  }

  async completeInitialPassword(password: string): Promise<void> {
    await httpsCallable(getFunctions(getFirebaseApp(), "southamerica-east1"), "completeInitialPassword")({ password });
    await getFirebaseAuth().currentUser?.getIdToken(true);
  }
  async listAccounts(): Promise<AccountAccess[]> {
    const result = await getDocs(collection(getDb(), paths.accounts()));
    return result.docs.map(document => document.data() as AccountAccess);
  }
  async registerProfessional(input: ProfessionalRegistration): Promise<{ userId: string; temporaryPassword: string }> {
    const result = await httpsCallable<ProfessionalRegistration, { userId: string; temporaryPassword: string }>(getFunctions(getFirebaseApp(), "southamerica-east1"), "registerProfessional")(input);
    return result.data;
  }
  async updateAccount(userId: string, input: AccessUpdate): Promise<void> {
    await httpsCallable(getFunctions(getFirebaseApp(), "southamerica-east1"), "updateAccount")({ userId, ...input });
  }
}

export const firebaseAuthAdapter: AuthAdapter = new FirebaseAuthAdapter();
