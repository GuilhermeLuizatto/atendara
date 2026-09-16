import { createRequire } from "node:module";

/**
 * SDK administrativo para as suites de acesso: semeia e inspeciona o emulador
 * sem passar pelas Security Rules.
 *
 * Vem de `functions/node_modules` porque o backend e quem depende dele — o
 * aplicativo nao carrega SDK administrativo. A partir do firebase-admin 14 a
 * API antiga (`admin.firestore()`, `admin.auth()`) deixou de existir; aqui
 * ficam os equivalentes modulares, num lugar so, para uma troca de versao nao
 * espalhar mudanca por sete arquivos de teste.
 */

const require = createRequire(import.meta.url);

const appModule = require("../../../functions/node_modules/firebase-admin/lib/app/index.js");
const authModule = require("../../../functions/node_modules/firebase-admin/lib/auth/index.js");
const firestoreModule = require("../../../functions/node_modules/firebase-admin/lib/firestore/index.js");

/** Inicializa uma vez por processo; chamar de novo nao derruba o que existe. */
export function initializeAdminSdk(projectId: string): void {
  if (appModule.getApps().length === 0) appModule.initializeApp({ projectId });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- o SDK entra por `require`, sem tipos.
export const adminAuth = (): any => authModule.getAuth();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem.
export const adminDb = (): any => firestoreModule.getFirestore();

/** `Timestamp` do SDK administrativo, para semear campos de data no emulador. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem.
export const AdminTimestamp: any = firestoreModule.Timestamp;

/** Encerra as instancias administrativas no fim da suite. */
export async function deleteAdminApps(): Promise<void> {
  await Promise.all(appModule.getApps().map((instance: unknown) => appModule.deleteApp(instance)));
}
