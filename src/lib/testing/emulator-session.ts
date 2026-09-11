import { deleteApp, initializeApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore, terminate, type Firestore } from "firebase/firestore";

/**
 * Sessoes e chamadas para as suites de acesso no emulador.
 *
 * Existe por dois limites do emulador, nao por atalho nas regras:
 *
 * 1. O emulador de Auth nao emite login com TOTP — so SMS. A operadora entra
 *    aqui com um token NAO ASSINADO que carrega o mesmo claim que o Identity
 *    Platform grava (`firebase.sign_in_second_factor`). O emulador aceita token
 *    nao assinado; producao nao. Nenhum codigo do aplicativo, das regras ou das
 *    functions sabe que este arquivo existe.
 * 2. As callables exigem App Check. O emulador das functions decodifica o token
 *    sem verificar, entao um token ficticio prova o caminho — e a ausencia dele
 *    prova a recusa.
 *
 * Chamada HTTP direta, no protocolo das callables, para controlar os dois
 * cabecalhos. Nunca importado pelo aplicativo.
 */

export const PROJECT = "demo-atendara";
export const REGION = "southamerica-east1";
export const FUNCTIONS_PORT = 5002;

const [FIRESTORE_HOST, FIRESTORE_PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8087").split(":");

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function unsignedJwt(payload: object): string {
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}

export interface TokenOptions {
  /** Segundos desde o login. Acima de 300, callables que pedem login recente recusam. */
  signedInSecondsAgo?: number;
}

/** Token de ID nao assinado, com ou sem segundo fator. */
export function unsignedIdToken(uid: string, secondFactor: string | null, options: TokenOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return unsignedJwt({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now - (options.signedInSecondsAgo ?? 0),
    firebase: {
      sign_in_provider: "password",
      ...(secondFactor ? { sign_in_second_factor: secondFactor } : {}),
    },
  });
}

function appCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return unsignedJwt({
    sub: "1:000000000000:web:atendara-testes",
    iss: "https://firebaseappcheck.googleapis.com/000000000000",
    aud: [`projects/${PROJECT}`],
    iat: now,
    exp: now + 3600,
  });
}

export class CallableError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CallableError";
  }
}

/** Callable pelo protocolo HTTP. `code` no formato `permission-denied`. */
export async function callFunction<Result = unknown>(
  name: string,
  data: unknown,
  options: { idToken?: string | null; appCheck?: boolean } = {},
): Promise<Result> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.idToken) headers.Authorization = `Bearer ${options.idToken}`;
  if (options.appCheck !== false) headers["X-Firebase-AppCheck"] = appCheckToken();

  const response = await fetch(`http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT}/${REGION}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    result?: Result;
    error?: { status?: string; message?: string };
  };
  if (body.error) {
    throw new CallableError(String(body.error.status ?? "INTERNAL").toLowerCase().replace(/_/g, "-"), body.error.message ?? "");
  }
  if (!response.ok) throw new CallableError("internal", `HTTP ${response.status}`);
  return body.result as Result;
}

let sessions = 0;

export interface TokenSession {
  idToken: string;
  firestore: Firestore;
  call<Result = unknown>(name: string, data: unknown): Promise<Result>;
  dispose(): Promise<void>;
}

/** Sessao com token fixo: Firestore e callables enxergam o mesmo usuario. */
export function tokenSession(uid: string, secondFactor: string | null, options: TokenOptions = {}): TokenSession {
  const idToken = unsignedIdToken(uid, secondFactor, options);
  const app = initializeApp({ projectId: PROJECT, apiKey: "chave-de-emulador" }, `sessao-de-teste-${++sessions}`);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, FIRESTORE_HOST, Number(FIRESTORE_PORT), { mockUserToken: idToken });
  return {
    idToken,
    firestore,
    call: (name, data) => callFunction(name, data, { idToken }),
    dispose: async () => {
      await terminate(firestore);
      await deleteApp(app);
    },
  };
}
