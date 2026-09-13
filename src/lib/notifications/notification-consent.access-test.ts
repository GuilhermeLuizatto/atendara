import { createRequire } from "node:module";

import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
  terminate,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NOTIFICATION_CONSENT_TEXT_VERSION } from "@/config/notifications";
import { paths } from "@/lib/firebase/paths";
import {
  applyConsentChanges,
  channelHistory,
  consentProblemFor,
  plannedConsentChanges,
} from "@/lib/notifications";
import { PROJECT, callFunction, tokenSession, type TokenSession } from "@/lib/testing/emulator-session";
import type {
  ClientDataExport,
  ConsentMedium,
  LegalGuardian,
  LegacyNotificationConsent,
  OutboundChannel,
  StoredNotificationConsent,
} from "@/types";

/**
 * Fase 3, 13.1: consentimento por canal, de ponta a ponta.
 *
 * Auth, Security Rules reais e a exportacao do titular. Prova que a equipe
 * registra em nome proprio, com meio, versao do texto e responsavel legal; que
 * retirar um canal nao apaga o historico dele; e que so quem escreve cadastro
 * registra. Os valores gravados saem das mesmas funcoes que a tela usa. Todo dado
 * e ficticio: dominios `.invalid`, telefones com DDD 00.
 *
 * Rodar com: npm run test:access
 */

const require = createRequire(import.meta.url);
const admin = require("../../../functions/node_modules/firebase-admin/lib/index.js");

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9098";
const [FIRESTORE_HOST, FIRESTORE_PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8087").split(":");

const OPERATOR_UID = "operadora-do-consentimento";
const ASSISTANT_UID = "recepcao-do-consentimento";
const VIEWER_UID = "leitura-do-consentimento";
const TITULAR_A = { name: "Titular A Consentimento", email: "titular-a-consentimento@atendara.test", password: "SenhaDeTeste-Consentimento-A1" };
const TITULAR_B = { name: "Titular B Consentimento", email: "titular-b-consentimento@atendara.test", password: "SenhaDeTeste-Consentimento-B1" };
const MODULES = ["dashboard", "agenda", "clientes"];
const CLIENT_ID = "cliente-com-consentimento";
const LEGACY_CLIENT_ID = "cliente-formato-antigo";
const GUARDIAN: LegalGuardian = { fullName: "Rui Responsavel Ficticio", relationship: "PARENT" };

// Documento cru do SDK administrativo, lido so para assercao.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stored = Record<string, any>;

interface Person {
  uid: string;
  organizationId: string;
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  call<Result = unknown>(name: string, data: unknown): Promise<Result>;
}

let operator: TokenSession;
let assistant: TokenSession;
let viewer: TokenSession;
let titularA: Person;
let titularB: Person;

const fs = () => admin.firestore();
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const clientPath = (id: string) => paths.document(titularA.organizationId, "clients", id);

async function stored(id: string): Promise<Stored> {
  return (await fs().doc(clientPath(id)).get()).data();
}

async function expectDenied(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: "permission-denied" });
}

/** O que a tela grava quando os canais vigentes passam a ser `channels`. */
function consentFor(
  saved: StoredNotificationConsent | null,
  channels: OutboundChannel[],
  userId: string,
  medium: ConsentMedium,
  legalGuardian: LegalGuardian | null = null,
): StoredNotificationConsent | null {
  return applyConsentChanges(
    saved,
    plannedConsentChanges(saved, channels),
    { at: new Date().toISOString(), recordedBy: { kind: "STAFF", userId }, medium },
    { textVersion: NOTIFICATION_CONSENT_TEXT_VERSION, subjectIsMinor: legalGuardian !== null, legalGuardian },
  );
}

async function registerAndSignIn(titular: typeof TITULAR_A): Promise<Person> {
  const created = await operator.call<{ userId: string; temporaryPassword: string }>("registerProfessional", {
    displayName: titular.name,
    email: titular.email,
    professionId: "PSYCHOLOGIST",
    modules: MODULES,
    initialGrant: { kind: "PILOT", until: inDays(10), reason: "Piloto dos testes de consentimento." },
  });
  const app = initializeApp({ projectId: PROJECT, apiKey: "chave-de-emulador" }, `consentimento-${created.userId}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE_HOST, Number(FIRESTORE_PORT));

  await signInWithEmailAndPassword(auth, titular.email, created.temporaryPassword);
  await callFunction("completeInitialPassword", { password: titular.password }, { idToken: await auth.currentUser!.getIdToken() });
  await signInWithEmailAndPassword(auth, titular.email, titular.password);

  return {
    uid: created.userId,
    organizationId: (await fs().doc(paths.account(created.userId)).get()).data().organizationId,
    app,
    auth,
    db,
    call: async (name, payload) => callFunction(name, payload, { idToken: await auth.currentUser!.getIdToken() }),
  };
}

/** Membro sem Auth de verdade: entra pelo token de teste, com conta e vinculo semeados. */
async function seedMember(uid: string, organizationId: string, role: string): Promise<TokenSession> {
  await fs().doc(paths.account(uid)).set({
    userId: uid,
    email: `${uid}@atendara.test`,
    displayName: uid,
    platformRole: "PROFESSIONAL",
    organizationId,
    professionId: "PSYCHOLOGIST",
    modules: MODULES,
    status: "ACTIVE",
    mustChangePassword: false,
    subscriptionStatus: "ACTIVE",
    accessUntil: inDays(30),
    accessUntilMs: Date.parse(inDays(30)),
    createdAt: new Date().toISOString(),
  });
  await fs().doc(paths.document(organizationId, "members", uid)).set({ id: uid, userId: uid, organizationId, role, status: "ACTIVE" });
  return tokenSession(uid, null);
}

function clientDocument(organizationId: string, consent: StoredNotificationConsent | null): Record<string, unknown> {
  return {
    organizationId,
    fullName: "Bia Exemplo Consentimento",
    preferredName: null,
    email: "bia@exemplo.invalid",
    phone: "+550000000009",
    status: "ACTIVE",
    appointmentNotificationsEnabled: true,
    notificationConsent: consent,
  };
}

beforeAll(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = `${FIRESTORE_HOST}:${FIRESTORE_PORT}`;
  admin.initializeApp({ projectId: PROJECT });

  await fs().doc(paths.account(OPERATOR_UID)).set({
    userId: OPERATOR_UID, email: "operadora-consentimento@atendara.test", displayName: "Operadora", platformRole: "PLATFORM_ADMIN",
    professionId: null, organizationId: null, modules: [], status: "ACTIVE", mustChangePassword: false, createdAt: new Date().toISOString(),
  });
  operator = tokenSession(OPERATOR_UID, "totp");

  titularA = await registerAndSignIn(TITULAR_A);
  titularB = await registerAndSignIn(TITULAR_B);
  assistant = await seedMember(ASSISTANT_UID, titularA.organizationId, "ASSISTANT");
  viewer = await seedMember(VIEWER_UID, titularA.organizationId, "VIEWER");
}, 120_000);

afterAll(async () => {
  for (const person of [titularA, titularB]) {
    if (!person) continue;
    await signOut(person.auth).catch(() => {});
    await terminate(person.db);
    await deleteApp(person.app);
  }
  await Promise.all([operator, assistant, viewer].filter(Boolean).map((session) => session.dispose()));
  await Promise.all(admin.apps.map((instance: { delete(): Promise<void> }) => instance.delete()));
});

describe("Fase 3, 13.1 — consentimento por canal", () => {
  it("a equipe registra por canal, em nome proprio, com meio, versao do texto e responsavel legal", async () => {
    const orgA = titularA.organizationId;
    const consent = consentFor(null, ["EMAIL", "WHATSAPP"], titularA.uid, "WRITTEN_DOCUMENT", GUARDIAN);

    // Em nome de outra pessoa, ou afirmando que a propria pessoa registrou: nao.
    await expectDenied(setDoc(doc(assistant.firestore, clientPath("forjado")), clientDocument(orgA, consent)));
    const bySubject = applyConsentChanges(null, [{ channel: "EMAIL", kind: "GRANTED" }],
      { at: new Date().toISOString(), recordedBy: { kind: "SUBJECT", userId: null }, medium: "MESSAGE" },
      { textVersion: NOTIFICATION_CONSENT_TEXT_VERSION, subjectIsMinor: false, legalGuardian: null });
    await expectDenied(setDoc(doc(titularA.db, clientPath("pela-propria-pessoa")), clientDocument(orgA, bySubject)));

    await setDoc(doc(titularA.db, clientPath(CLIENT_ID)), clientDocument(orgA, consent));

    const saved = await stored(CLIENT_ID);
    expect(channelHistory(saved.notificationConsent, "EMAIL")).toEqual([
      {
        granted: { at: expect.any(String), recordedBy: { kind: "STAFF", userId: titularA.uid }, medium: "WRITTEN_DOCUMENT" },
        textVersion: NOTIFICATION_CONSENT_TEXT_VERSION,
        subjectIsMinor: true,
        legalGuardian: GUARDIAN,
        withdrawn: null,
      },
    ]);
    expect(consentProblemFor(saved, "EMAIL")).toBeNull();
    expect(consentProblemFor(saved, "WHATSAPP")).toBeNull();
    expect(consentProblemFor(saved, "SMS")).toBe("CHANNEL_NOT_CONSENTED");
  });

  it("retirar um canal nao apaga o historico, e so quem escreve cadastro registra", async () => {
    const saved = (await stored(CLIENT_ID)).notificationConsent as StoredNotificationConsent;
    const granted = channelHistory(saved, "WHATSAPP")[0];
    const path = clientPath(CLIENT_ID);

    // Quem so le nao retira; outro tenant nao alcanca; ninguem apaga.
    await expectDenied(updateDoc(doc(viewer.firestore, path), { notificationConsent: consentFor(saved, ["EMAIL"], VIEWER_UID, "MESSAGE") }));
    await expectDenied(updateDoc(doc(titularB.db, path), { notificationConsent: consentFor(saved, ["EMAIL"], titularB.uid, "MESSAGE") }));
    await expectDenied(updateDoc(doc(assistant.firestore, path), { notificationConsent: null }));
    await expectDenied(
      updateDoc(doc(assistant.firestore, path), {
        notificationConsent: { formatVersion: 2, channels: { EMAIL: channelHistory(saved, "EMAIL") }, legacy: null },
      }),
    );

    // A recepcao registra a retirada pedida por mensagem.
    const withdrawn = consentFor(saved, ["EMAIL"], ASSISTANT_UID, "MESSAGE");
    await updateDoc(doc(assistant.firestore, path), { notificationConsent: withdrawn });
    const afterWithdrawal = await stored(CLIENT_ID);
    expect(channelHistory(afterWithdrawal.notificationConsent, "WHATSAPP")).toEqual([
      { ...granted, withdrawn: { at: expect.any(String), recordedBy: { kind: "STAFF", userId: ASSISTANT_UID }, medium: "MESSAGE" } },
    ]);
    expect(consentProblemFor(afterWithdrawal, "WHATSAPP")).toBe("CONSENT_REVOKED");
    expect(consentProblemFor(afterWithdrawal, "EMAIL")).toBeNull();

    // Autorizar de novo acrescenta, com o registro retirado intacto.
    await updateDoc(doc(titularA.db, path), {
      notificationConsent: consentFor(afterWithdrawal.notificationConsent, ["EMAIL", "WHATSAPP"], titularA.uid, "FORM", GUARDIAN),
    });
    const regranted = await stored(CLIENT_ID);
    const history = channelHistory(regranted.notificationConsent, "WHATSAPP");
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(channelHistory(afterWithdrawal.notificationConsent, "WHATSAPP")[0]);
    expect(history[1]).toMatchObject({ granted: { medium: "FORM", recordedBy: { userId: titularA.uid } }, withdrawn: null });
    expect(consentProblemFor(regranted, "WHATSAPP")).toBeNull();
  });

  it("a exportacao a pedido do titular leva o historico inteiro do consentimento", async () => {
    const exported = await titularA.call<ClientDataExport>("exportClientData", { clientId: CLIENT_ID, receivedVia: "EMAIL" });
    const consent = exported.subject.notificationConsent as StoredNotificationConsent;

    const whatsapp = channelHistory(consent, "WHATSAPP");
    expect(whatsapp).toHaveLength(2);
    expect(whatsapp[0]).toMatchObject({ withdrawn: { medium: "MESSAGE", recordedBy: { userId: ASSISTANT_UID } }, legalGuardian: GUARDIAN });
    expect(whatsapp[1]).toMatchObject({ withdrawn: null });
  });

  it("cadastro no formato antigo nao autoriza aviso, e passar ao registro por canal guarda o antigo inteiro", async () => {
    const orgA = titularA.organizationId;
    const legacy: LegacyNotificationConsent = {
      channels: ["EMAIL"], grantedAt: "2026-09-01T10:00:00.000Z", revokedAt: null, source: "CLIENT_FORM", textVersion: "2026-09-10-rascunho",
    };
    await fs().doc(clientPath(LEGACY_CLIENT_ID)).set(clientDocument(orgA, legacy));
    expect(consentProblemFor(await stored(LEGACY_CLIENT_ID), "EMAIL")).toBe("CONSENT_INCOMPLETE");

    const path = doc(titularA.db, clientPath(LEGACY_CLIENT_ID));
    const converted = consentFor(legacy, ["EMAIL"], titularA.uid, "FORM");
    await expectDenied(updateDoc(path, { notificationConsent: { ...converted, legacy: null } }));
    await updateDoc(path, { notificationConsent: converted });

    const saved = await stored(LEGACY_CLIENT_ID);
    expect(saved.notificationConsent.legacy).toEqual(legacy);
    expect(consentProblemFor(saved, "EMAIL")).toBeNull();
  });
});
