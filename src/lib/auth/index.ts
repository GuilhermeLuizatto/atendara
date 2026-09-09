import { isFirebaseConfigured } from "@/lib/firebase/config";

import { demoAuthAdapter } from "./demo-adapter";
import { firebaseAuthAdapter } from "./firebase-adapter";
import type { AuthAdapter } from "./types";

/**
 * Escolhe o adaptador uma unica vez, com base na presenca de configuracao.
 * Sem projeto Firebase, o prototipo roda em modo demonstracao — que e o
 * caminho padrao para quem clona o repositorio.
 */
export const authAdapter: AuthAdapter = isFirebaseConfigured && process.env.NEXT_PUBLIC_DEMO_MODE !== "true"
  ? firebaseAuthAdapter
  : demoAuthAdapter;

export { AuthError, type AuthAdapter, type AuthMode } from "./types";
