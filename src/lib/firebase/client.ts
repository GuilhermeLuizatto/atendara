import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from "firebase/app-check";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";

import { appCheckSiteKey, getFirebaseConfig, useEmulators } from "./config";

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
let authEmulatorConnected = false;
let dbEmulatorConnected = false;
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
