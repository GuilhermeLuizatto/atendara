import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from "firebase/app-check";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from "firebase/storage";

import { appCheckSiteKey, getFirebaseConfig, useEmulators } from "./config";

/** Onde as callables sao publicadas. O mesmo valor de `platform-auth.js`. */
const FUNCTIONS_REGION = "southamerica-east1";

/**
 * Inicializacao preguicosa e idempotente do SDK cliente.
 *
 * Nada roda no import: em modo demonstracao o SDK nunca chega a ser
 * inicializado, e o bundle do Firebase so e realmente exercitado quando ha
 * projeto configurado.
 */

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;
let cachedFunctions: Functions | null = null;
let cachedStorage: FirebaseStorage | null = null;
let authEmulatorConnected = false;
let dbEmulatorConnected = false;
let storageEmulatorConnected = false;
let appCheckActivated = false;

export function getFirebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  cachedApp = getApps().length ? getApp() : initializeApp(getFirebaseConfig());
  activateAppCheck(cachedApp);
  return cachedApp;
}

/**
 * App Check antes de qualquer chamada: Functions e Firestore anexam o token
 * sozinhos quando ele esta ativo no app. As callables exigem o token, entao um
 * build sem a chave de site falha fechado.
 */
function activateAppCheck(app: FirebaseApp): void {
  if (appCheckActivated || typeof window === "undefined") return;
  appCheckActivated = true;
  if (useEmulators) {
    // Emulador local: token de depuracao, que o emulador das functions aceita.
    (self as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  if (!appCheckSiteKey) {
    console.warn("App Check sem chave de site: as callables vão recusar este aplicativo.");
    return;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getFirebaseApp());
  connectEmulatorsOnce();
  return cachedAuth;
}

export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(getFirebaseApp());
  connectEmulatorsOnce();
  return cachedDb;
}

/**
 * As callables, na regiao onde elas vivem.
 *
 * Existe por causa do emulador: `getFunctions` sozinho aponta sempre para a
 * nuvem, e uma verificacao local acabaria chamando producao — que e exatamente
 * o que nao se quer ao conferir uma tela nova.
 */
export function getFirebaseFunctions(): Functions {
  if (cachedFunctions) return cachedFunctions;
  cachedFunctions = getFunctions(getFirebaseApp(), FUNCTIONS_REGION);
  if (useEmulators && typeof window !== "undefined") {
    connectFunctionsEmulator(cachedFunctions, "127.0.0.1", 5001);
  }
  return cachedFunctions;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (cachedStorage) return cachedStorage;
  cachedStorage = getStorage(getFirebaseApp());
  if (useEmulators && typeof window !== "undefined" && !storageEmulatorConnected) {
    storageEmulatorConnected = true;
    connectStorageEmulator(cachedStorage, "127.0.0.1", 9199);
  }
  return cachedStorage;
}

function connectEmulatorsOnce(): void {
  if (!useEmulators) return;
  if (typeof window === "undefined") return;

  if (cachedAuth && !authEmulatorConnected) {
    authEmulatorConnected = true;
    connectAuthEmulator(cachedAuth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  }
  if (cachedDb && !dbEmulatorConnected) {
    dbEmulatorConnected = true;
    connectFirestoreEmulator(cachedDb, "127.0.0.1", 8080);
  }
}
