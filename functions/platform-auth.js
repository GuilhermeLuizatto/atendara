import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

import { paths } from "./generated/paths.js";
import { hasRequiredSecondFactor } from "./generated/access-gate.js";

/**
 * Quem chama as callables de conta e de plataforma.
 *
 * Separado do index.js porque as callables de concessao (platform.js) usam o
 * mesmo portao da operadora, e dois portoes divergiriam.
 */

export const REGION = "southamerica-east1";

/**
 * `enforceAppCheck`: requisicao sem atestado do aplicativo e recusada antes do
 * handler. Nao substitui autenticacao; tira do caminho quem tem so a chave
 * publica do app e um script.
 */
export const ACCOUNT_CALL_OPTIONS = { region: REGION, maxInstances: 2, cors: true, enforceAppCheck: true };

// `getFirestore()` preguicoso: os modulos sao avaliados antes de
// `initializeApp()` do index.js.
const db = () => getFirestore();

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpsError("invalid-argument", "Confira os dados informados.");
  return result.data;
}

export async function accountOf(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Entre na sua conta.");
  const account = (await db().doc(paths.account(request.auth.uid)).get()).data();
  if (!account || account.status !== "ACTIVE") throw new HttpsError("permission-denied", "Cadastro nao liberado.");
  return account;
}

/**
 * A operadora, com segundo fator na sessao. O mesmo predicado vale
 * em `platformAdmin()` nas Security Rules; senha comprometida sozinha nao
 * cadastra, nao altera conta e nao concede acesso.
 */
export async function adminOf(request) {
  const account = await accountOf(request);
  if (account.platformRole !== "PLATFORM_ADMIN" || account.mustChangePassword) {
    throw new HttpsError("permission-denied", "Apenas o administrador pode gerenciar acessos.");
  }
  if (!hasRequiredSecondFactor(request.auth.token)) {
    throw new HttpsError("permission-denied", "Entre com o segundo fator (aplicativo autenticador) para usar a administracao.");
  }
  return account;
}
