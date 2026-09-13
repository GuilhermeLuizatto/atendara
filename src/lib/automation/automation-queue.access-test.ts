import { createRequire } from "node:module";

import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut, type Auth } from "firebase/auth";
import {
  Timestamp,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  setDoc,
  terminate,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NOTIFICATION_CONSENT_TEXT_VERSION } from "@/config/notifications";
import { toFirestoreData } from "@/lib/firebase/converters";
import { paths } from "@/lib/firebase/paths";
import { applyConsentChanges, plannedConsentChanges } from "@/lib/notifications";
import { PROJECT, callFunction, tokenSession, type TokenSession } from "@/lib/testing/emulator-session";

/**
 * Fase 3, 13.2: a fila de automacao de ponta a ponta.
 *
 * Auth, Security Rules reais, o gatilho do Firestore e a Cloud Tasks emulados.
 * O titular configura avisos, registra consentimento e confirma um atendimento
 * pelo navegador; o backend planeja, enfileira, confere as travas e executa com
 * o provedor simulado. O navegador so le a entrega e nao alcanca a fila.
 *
 * Limite do emulador: a Cloud Tasks emulada executa na hora, sem esperar
 * `scheduleTime`. Por isso o caminho completo aqui e o da confirmacao, que sai no
 * instante da escrita; lembrete, tarefa vencida, reentrega, consentimento
 * retirado e remarcacao estao em `functions/automation.emulator-test.js` e nos
 * testes puros de `src/lib/automation`.
 *
 * Todo dado e ficticio: telefones com DDD 00.
 *
 * Rodar com: npm run test:access
 */

const require = createRequire(import.meta.url);
const admin = require("../../../functions/node_modules/firebase-admin/lib/index.js");

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9098";
const [FIRESTORE_HOST, FIRESTORE_PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8087").split(":");

const OPERATOR_UID = "operadora-da-fila";
const TITULAR = { name: "Titular Fila Automacao", email: "titular-fila@atendara.test", password: "SenhaDeTeste-Fila-A1" };
const MODULES = ["dashboard", "agenda", "clientes"];
const CLIENT_ID = "cliente-da-fila";
const APPOINTMENT_ID = "atendimento-da-fila";

// Documento cru do SDK administrativo, lido so para assercao.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stored = Record<string, any>;

let operator: TokenSession;
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let uid: string;
let organizationId: string;

const fs = () => admin.firestore();
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 40_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function ofAppointment(name: "automationTasks" | "notificationDeliveries"): Promise<Stored[]> {
  const snapshot = await fs().collection(paths.collection(organizationId, name)).where("appointmentId", "==", APPOINTMENT_ID).get();
  return snapshot.docs.map((entry: { id: string; data(): Stored }) => ({ id: entry.id, ...entry.data() }));
}

beforeAll(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = `${FIRESTORE_HOST}:${FIRESTORE_PORT}`;
  admin.initializeApp({ projectId: PROJECT });

  await fs().doc(paths.account(OPERATOR_UID)).set({
    userId: OPERATOR_UID, email: "operadora-fila@atendara.test", displayName: "Operadora", platformRole: "PLATFORM_ADMIN",
    professionId: null, organizationId: null, modules: [], status: "ACTIVE", mustChangePassword: false, createdAt: new Date().toISOString(),
  });
  operator = tokenSession(OPERATOR_UID, "totp");

  const created = await operator.call<{ userId: string; temporaryPassword: string }>("registerProfessional", {
    displayName: TITULAR.name,
    email: TITULAR.email,
    professionId: "PERSONAL_TRAINER",
    modules: MODULES,
    initialGrant: { kind: "PILOT", until: inDays(10), reason: "Piloto dos testes da fila de automacao." },
  });
  uid = created.userId;
  app = initializeApp({ projectId: PROJECT, apiKey: "chave-de-emulador" }, `fila-${uid}`);
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE_HOST, Number(FIRESTORE_PORT));
  await signInWithEmailAndPassword(auth, TITULAR.email, created.temporaryPassword);
  await callFunction("completeInitialPassword", { password: TITULAR.password }, { idToken: await auth.currentUser!.getIdToken() });
  await signInWithEmailAndPassword(auth, TITULAR.email, TITULAR.password);
  organizationId = (await fs().doc(paths.account(uid)).get()).data().organizationId;
}, 120_000);

afterAll(async () => {
  if (auth) await signOut(auth).catch(() => {});
  if (db) await terminate(db);
  if (app) await deleteApp(app);
  if (operator) await operator.dispose();
  await Promise.all(admin.apps.map((instance: { delete(): Promise<void> }) => instance.delete()));
});

describe("Fase 3, 13.2 — fila de automacao no servidor", () => {
  it("confirmar pelo navegador: o gatilho planeja, a fila executa e o navegador so le o resultado", async () => {
    const now = new Date().toISOString();

    // O titular liga a confirmacao por SMS — so ela. Pelas regras, como sempre.
    await updateDoc(doc(db, paths.organization(organizationId)), {
      "settings.notifications": {
        enabled: true,
        verifiedSenderChannels: ["SMS"],
        rules: [{ id: "APPOINTMENT_CONFIRMED:SMS", event: "APPOINTMENT_CONFIRMED", channel: "SMS", enabled: true, leadMinutes: 0, customTemplate: null }],
      },
      updatedAt: now,
      updatedBy: uid,
    });

    const notificationConsent = applyConsentChanges(
      null,
      plannedConsentChanges(null, ["SMS"]),
      { at: now, recordedBy: { kind: "STAFF", userId: uid }, medium: "FORM" },
      { textVersion: NOTIFICATION_CONSENT_TEXT_VERSION, subjectIsMinor: false, legalGuardian: null },
    );
    await setDoc(
      doc(db, paths.document(organizationId, "clients", CLIENT_ID)),
      toFirestoreData("clients", {
        id: CLIENT_ID, organizationId, fullName: "Duda Ficticia Fila", preferredName: "Duda", email: null, phone: "+5500900000000",
        status: "ACTIVE", preferredModality: "IN_PERSON", assignedProfessionalId: uid, acquisitionChannel: "OTHER", tags: [],
        administrativeNotes: null, appointmentNotificationsEnabled: true, notificationConsent,
        createdAt: now, updatedAt: now, createdBy: uid, updatedBy: uid,
      }),
    );

    const startsAt = inDays(2);
    await setDoc(
      doc(db, paths.document(organizationId, "appointments", APPOINTMENT_ID)),
      toFirestoreData("appointments", {
        id: APPOINTMENT_ID, organizationId, clientId: CLIENT_ID, clientName: "Duda Ficticia Fila", professionalId: uid,
        professionalName: TITULAR.name, startsAt, endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
        durationMinutes: 60, modality: "IN_PERSON", status: "SCHEDULED", priceInCents: 0, administrativeNotes: null, origin: "MANUAL",
        confirmedAt: null, cancelledAt: null, cancellationReason: null, rescheduledFromId: null, externalCalendar: null,
        createdAt: now, updatedAt: now, createdBy: uid, updatedBy: uid,
      }),
    );

    await updateDoc(doc(db, paths.document(organizationId, "appointments", APPOINTMENT_ID)), {
      status: "CONFIRMED",
      confirmedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      updatedBy: uid,
    });

    const deliveries = await eventually(
      () => ofAppointment("notificationDeliveries"),
      (items) => items.some((item) => item.status === "SENT"),
    );
    expect(deliveries.map((item) => [item.event, item.status, item.attempts])).toEqual([["APPOINTMENT_CONFIRMED", "SENT", 1]]);
    expect(deliveries[0].providerMessageId).toMatch(/^sim_/);
    expect(JSON.stringify(deliveries)).not.toContain("+5500900000000");

    const tasks = await eventually(
      () => ofAppointment("automationTasks"),
      (items) => items.some((item) => item.type === "WRITE_AUDIT"),
    );
    const [notice] = tasks.filter((task) => task.deliveryId);
    // Agendar nao planejou nada: nao ha regra de lembrete, e agendamento ainda
    // nao tem tarefa. So a confirmacao, com a regra dela, virou envio.
    expect(tasks.filter((task) => task.deliveryId)).toHaveLength(1);
    expect(notice).toMatchObject({ type: "CONFIRM_APPOINTMENT", status: "SUCCEEDED", attempt: 1 });
    expect(notice.history.map((step: Stored) => step.to)).toEqual(["PLANNED", "SCHEDULED", "DISPATCHING", "DISPATCHED", "SUCCEEDED"]);
    expect(tasks.filter((task) => task.type === "WRITE_AUDIT").map((task) => task.status)).toEqual(["SUCCEEDED"]);

    const trail = await fs().collection(paths.collection(organizationId, "auditLogs")).where("metadata.automationTaskId", "==", notice.id).get();
    expect(trail.docs.map((entry: { data(): Stored }) => entry.data().metadata.status)).toEqual(["SUCCEEDED"]);

    // O navegador le a entrega, e so.
    const deliveryRef = doc(db, paths.document(organizationId, "notificationDeliveries", notice.id));
    expect((await getDoc(deliveryRef)).data()?.status).toBe("SENT");
    await expect(updateDoc(deliveryRef, { status: "FAILED", attempts: 0 })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(getDoc(doc(db, paths.document(organizationId, "automationTasks", notice.id)))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(getDocs(query(collection(db, paths.collection(organizationId, "automationTasks")), limit(5)))).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(
      setDoc(doc(db, paths.document(organizationId, "automationTasks", "forjada")), { organizationId, type: "WRITE_AUDIT", status: "SUCCEEDED" }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  }, 90_000);
});
