/**
 * Leitura da configuracao publica do Firebase.
 *
 * As variaveis precisam ser referenciadas de forma literal (`process.env.NOME`)
 * para que o Next as substitua em tempo de build. Acesso dinamico por indice
 * resulta em `undefined` no navegador.
 *
 * Nenhum destes valores e segredo — sao identificadores publicos do projeto. A
 * protecao real dos dados esta nas Firestore Security Rules.
 */

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const rawConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function isComplete(
  config: Record<string, string | undefined>,
): config is Record<keyof FirebaseClientConfig, string> {
  return Object.values(config).every(
    (value) => typeof value === "string" && value.length > 0,
  );
}

/**
 * `true` quando ha um projeto Firebase configurado. Quando `false`, a aplicacao
 * roda em MODO DEMONSTRACAO com dados ficticios em memoria — e o que permite
 * clonar o repositorio e navegar no prototipo sem criar projeto nenhum.
 */
export const isFirebaseConfigured = isComplete(rawConfig);

export function getFirebaseConfig(): FirebaseClientConfig {
  if (!isComplete(rawConfig)) {
    throw new Error(
      "Firebase nao configurado. Defina as variaveis NEXT_PUBLIC_FIREBASE_* (ver .env.example).",
    );
  }
  return rawConfig;
}

/** Emuladores locais, ligados por NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true. */
export const useEmulators =
  process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === "true";
