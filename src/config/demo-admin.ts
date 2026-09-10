/**
 * Verificador do administrador da demonstracao, vindo de `.env.local`.
 *
 * `NEXT_PUBLIC_*` e copiado literalmente para o JavaScript publicado. Um build
 * com projeto Firebase configurado nunca usa o adaptador demo, e mesmo assim o
 * sal e o hash iam junto — legiveis por qualquer visitante, ao lado do e-mail
 * do administrador, prontos para tentativa offline.
 *
 * A condicao repete `isDemoMode` (`src/lib/firebase/config.ts`) com referencias
 * literais de proposito: o Next as troca por constantes no build e o
 * minificador descarta o ramo morto. Importar a condicao deixaria a decisao
 * para o navegador, e o texto seguiria no bundle do mesmo jeito.
 * `scripts/check-public-bundle.mjs` confere o artefato depois do build.
 */
const demoBuild =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
  !(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET &&
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID &&
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  );

export const DEMO_ADMIN_VERIFIER = demoBuild
  ? {
      salt: process.env.NEXT_PUBLIC_DEMO_ADMIN_SALT ?? "",
      hash: process.env.NEXT_PUBLIC_DEMO_ADMIN_HASH ?? "",
    }
  : { salt: "", hash: "" };
