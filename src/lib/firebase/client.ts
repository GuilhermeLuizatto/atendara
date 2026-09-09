import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";

import { getFirebaseConfig, useEmulators } from "./config";

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

export function getFirebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  cachedApp = getApps().length ? getApp() : initializeApp(getFirebaseConfig());
  return cachedApp;
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
