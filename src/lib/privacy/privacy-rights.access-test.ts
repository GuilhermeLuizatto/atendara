import { createRequire } from "node:module";

import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut, type Auth } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  terminate,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MASKED_CONTACT, PSEUDONYM_PREFIX, REDACTED_NAME, REDACTED_TEXT } from "@/config/privacy";
import { TENANT_COLLECTIONS, messagePath, messagesPath, paths } from "@/lib/firebase/paths";
import { PROJECT, callFunction, tokenSession, type TokenSession } from "@/lib/testing/emulator-session";
import type {
  ClientDataExport,
  OrganizationExportCursor,
  OrganizationExportPage,
  OrganizationExportStart,
  PrivacyOperationResult,
} from "@/types";

/**
 * Etapa 5C: direitos do titular dos dados, de ponta a ponta.
 *
 * Auth, callables com App Check, Firestore e as Security Rules reais. Prova
 * exportacao e eliminacao de um cliente, exportacao e exclusao de uma
 * organizacao, e que ninguem alcanca o tenant vizinho por nenhum desses
 * caminhos. Todo dado e ficticio: telefones com DDD 00, dominios `.invalid`.
 *
 * Rodar com: npm run test:access
 */

const require = createRequire(import.meta.url);
const admin = require("../../../functions/node_modules/firebase-admin/lib/index.js");

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9098";
const [FIRESTORE_HOST, FIRESTORE_PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8087").split(":");

const OPERATOR_UID = "operadora-dos-pedidos-de-titular";
const COLLEAGUE_UID = "colega-sem-responsabilidade";
const CLINIC_ADMIN_UID = "administradora-da-clinica";
const TITULAR_A = { name: "Titular A Privacidade", email: "titular-a-privacidade@atendara.test", password: "SenhaDeTeste-Privacidade-A1" };
const TITULAR_B = { name: "Titular B Privacidade", email: "titular-b-privacidade@atendara.test", password: "SenhaDeTeste-Privacidade-B1" };

const SUBJECT = { name: "Maria Exemplo Titular", prefix: "x" };
const CONTROL = { name: "Joao Controle Intacto", prefix: "y" };
const NEIGHBOR = { name: "Ana Vizinha Outro Tenant", prefix: "z" };
const MODULES = ["dashboard", "agenda", "clientes", "mensagens", "financeiro", "agente"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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
let colleague: TokenSession;
let clinicAdmin: TokenSession;
let titularA: Person;
let titularB: Person;
let subjectPseudonym: string;

const fs = () => admin.firestore();
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const timestamp = (iso: string) => admin.firestore.Timestamp.fromDate(new Date(iso));
const ids = (prefix: string) => ({
  client: `cliente-${prefix}`,
  appointment: `atendimento-${prefix}`,
  conversation: `conversa-${prefix}`,
  inbound: `mensagem-entrada-${prefix}`,
  outbound: `mensagem-saida-${prefix}`,
  transaction: `lancamento-${prefix}`,
  decision: `decisao-${prefix}`,
  notification: `alerta-${prefix}`,
  delivery: `envio-${prefix}`,
  audit: {
    client: `trilha-cadastro-${prefix}`,
    appointment: `trilha-atendimento-${prefix}`,
    conversation: `trilha-conversa-${prefix}`,
    transaction: `trilha-lancamento-${prefix}`,
  },
});
const X = ids(SUBJECT.prefix);
const Y = ids(CONTROL.prefix);
const Z = ids(NEIGHBOR.prefix);

async function data(path: string): Promise<Stored | undefined> {
  return (await fs().doc(path).get()).data();
}

async function sizeOf(path: string): Promise<number> {
  return (await fs().collection(path).get()).size;
}

async function expectDenied(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: "permission-denied" });
}

/** Tudo o que existe sob a organizacao, para procurar nome e id do titular. */
async function tenantDump(organizationId: string): Promise<unknown[]> {
  const documents: unknown[] = [await data(paths.organization(organizationId))];
  for (const name of Object.keys(TENANT_COLLECTIONS)) {
    if (name === "messages") continue;
    const snapshot = await fs().collection(paths.collection(organizationId, name as keyof typeof TENANT_COLLECTIONS)).get();
    documents.push(...snapshot.docs.map((document: { id: string; data(): unknown }) => ({ id: document.id, ...(document.data() as object) })));
  }
  const messages = await fs().collectionGroup("messages").where("organizationId", "==", organizationId).get();
  documents.push(...messages.docs.map((document: { id: string; data(): unknown }) => ({ id: document.id, ...(document.data() as object) })));
  return documents;
}

async function registerAndSignIn(titular: typeof TITULAR_A): Promise<Person> {
  const created = await operator.call<{ userId: string; temporaryPassword: string }>("registerProfessional", {
    displayName: titular.name,
    email: titular.email,
    professionId: "PSYCHOLOGIST",
    modules: MODULES,
    initialGrant: { kind: "PILOT", until: inDays(10), reason: "Piloto dos testes de privacidade." },
  });
  const app = initializeApp({ projectId: PROJECT, apiKey: "chave-de-emulador" }, `privacidade-${created.userId}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE_HOST, Number(FIRESTORE_PORT));

  await signInWithEmailAndPassword(auth, titular.email, created.temporaryPassword);
  await callFunction("completeInitialPassword", { password: titular.password }, { idToken: await auth.currentUser!.getIdToken() });
  await signInWithEmailAndPassword(auth, titular.email, titular.password);

  return {
    uid: created.userId,
    organizationId: (await data(paths.account(created.userId)))!.organizationId,
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

async function seedClient(organizationId: string, by: string, person: { name: string; prefix: string }): Promise<void> {
  const id = ids(person.prefix);
  const at = timestamp("2026-09-01T10:00:00.000Z");
  const stamp = { organizationId, createdAt: at, updatedAt: at, createdBy: by, updatedBy: by };
  const audit = (logId: string, type: string, resourceId: string, summary: string) =>
    fs().doc(paths.document(organizationId, "auditLogs", logId)).set({
      id: logId,
      ...stamp,
      actorType: "USER",
      actorId: by,
      actorName: "Recepcao de testes",
      action: "CREATE",
      resource: { type, id: resourceId },
      summary,
      metadata: { status: "ACTIVE" },
      occurredAt: at,
    });
  const set = (path: string, document: Record<string, unknown>) => fs().doc(path).set(document);

  await Promise.all([
    set(paths.document(organizationId, "clients", id.client), {
      id: id.client, ...stamp, fullName: person.name, preferredName: null, email: `${person.prefix}@exemplo.invalid`,
      phone: "+550000000009", status: "ACTIVE", preferredModality: "IN_PERSON", assignedProfessionalId: by,
      acquisitionChannel: "REFERRAL", tags: [], lastAppointmentAt: null, nextAppointmentAt: null,
      administrativeNotes: `Prefere manha. ${person.name}.`, totalAppointments: 1, outstandingBalanceInCents: 0,
      appointmentNotificationsEnabled: true,
      notificationConsent: { channels: ["EMAIL"], grantedAt: "2026-09-01T10:00:00.000Z", revokedAt: null, source: "CLIENT_FORM", textVersion: "teste" },
    }),
    set(paths.document(organizationId, "appointments", id.appointment), {
      id: id.appointment, ...stamp, clientId: id.client, clientName: person.name, professionalId: by, professionalName: "Profissional de testes",
      startsAt: timestamp("2026-09-02T13:00:00.000Z"), endsAt: timestamp("2026-09-02T13:50:00.000Z"), durationMinutes: 50,
      modality: "IN_PERSON", status: "COMPLETED", priceInCents: 20_000, administrativeNotes: `Estacionamento para ${person.name}`,
      origin: "MANUAL", confirmedAt: null, cancelledAt: null, cancellationReason: null, rescheduledFromId: null, externalCalendar: null,
    }),
    set(paths.document(organizationId, "conversations", id.conversation), {
      id: id.conversation, ...stamp, clientId: id.client, clientName: person.name, professionalId: by, channel: "WHATSAPP",
      status: "OPEN", attention: "NORMAL", lastClassification: "ADMINISTRATIVE", lastMessagePreview: `Oi, aqui e ${person.name}`,
      lastMessageAt: at, unreadCount: 0, escalated: false, escalationReason: null,
    }),
    set(messagePath(organizationId, id.conversation, id.inbound), {
      id: id.inbound, ...stamp, conversationId: id.conversation, clientId: id.client, direction: "INBOUND", authorType: "CLIENT",
      authorName: person.name, channel: "WHATSAPP", body: `Oi, aqui e ${person.name}. Quanto custa?`,
      sentAt: timestamp("2026-09-01T10:00:00.000Z"), readAt: null, classification: "ADMINISTRATIVE", classificationConfidence: 0.9, aiDecisionId: id.decision,
    }),
    set(messagePath(organizationId, id.conversation, id.outbound), {
      id: id.outbound, ...stamp, conversationId: id.conversation, clientId: id.client, direction: "OUTBOUND", authorType: "AI_AGENT",
      authorName: "Assistente", channel: "WHATSAPP", body: `Ola, ${person.name}. A sessao custa R$ 200.`,
      sentAt: timestamp("2026-09-01T10:00:05.000Z"), readAt: null, classification: null, classificationConfidence: null, aiDecisionId: id.decision,
    }),
    set(paths.document(organizationId, "transactions", id.transaction), {
      id: id.transaction, ...stamp, type: "INCOME", clientId: id.client, clientName: person.name, professionalId: by,
      appointmentId: id.appointment, description: `Sessao de ${person.name}`, amountInCents: 20_000, status: "PAID",
      method: "PIX", dueDate: at, paidAt: at, gateway: null,
    }),
    set(paths.document(organizationId, "aiDecisions", id.decision), {
      id: id.decision, ...stamp, conversationId: id.conversation, messageId: id.inbound, clientId: id.client, professionalId: by,
      inputPreview: `Oi, aqui e ${person.name}. Quanto custa?`, classification: "ADMINISTRATIVE", confidence: 0.91,
      appliedRules: [{ ruleId: "regra-precos", ruleName: "Informar valor", ruleVersion: 1, level: "PROFESSIONAL", outcome: "MATCHED" }],
      action: "AUTO_RESPONSE", responseText: `Ola, ${person.name}. A sessao custa R$ 200.`,
      reason: 'Pergunta exclusivamente administrativa coberta pela regra "Informar valor".', attention: "NORMAL",
      escalated: false, engineVersion: "1.0.0", decidedAt: at, latencyMs: 8,
    }),
    set(paths.document(organizationId, "notifications", id.notification), {
      id: id.notification, ...stamp, type: "CLIENT_WAITING", priority: "NORMAL", status: "UNREAD", title: `${person.name} aguarda atencao`,
      body: "Pergunta administrativa.", professionalId: by, target: { type: "conversation", id: id.conversation },
      channels: ["DASHBOARD"], aiDecisionId: id.decision, acknowledgedBy: null, acknowledgedAt: null,
    }),
    set(paths.document(organizationId, "notificationDeliveries", id.delivery), {
      id: id.delivery, ...stamp, audience: "ORGANIZATION_TO_CLIENT", event: "APPOINTMENT_REMINDER", channel: "EMAIL", ruleId: "regra-lembrete",
      appointmentId: id.appointment, clientId: id.client, professionalId: by, scheduledFor: at, status: "SENT", attempts: 1,
      lastAttemptAt: at, nextAttemptAt: null, providerId: "SIMULATED", providerMessageId: "simulado-1", failureCode: null,
      templateId: "lembrete", bodyHash: "abcdef12", bodyLength: 80, contactHint: "***@exemplo.invalid", sentAt: at, cancelledAt: null,
    }),
    audit(id.audit.client, "client", id.client, `Cadastro de ${person.name} criado.`),
    audit(id.audit.appointment, "appointment", id.appointment, `Atendimento de ${person.name} agendado.`),
    audit(id.audit.conversation, "conversation", id.conversation, 'Pergunta exclusivamente administrativa coberta pela regra "Informar valor".'),
    audit(id.audit.transaction, "transaction", id.transaction, `Lancamento "Sessao de ${person.name}" criado.`),
  ]);
}

beforeAll(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = `${FIRESTORE_HOST}:${FIRESTORE_PORT}`;
  admin.initializeApp({ projectId: PROJECT });

  await fs().doc(paths.account(OPERATOR_UID)).set({
    userId: OPERATOR_UID, email: "operadora-titulares@atendara.test", displayName: "Operadora", platformRole: "PLATFORM_ADMIN",
    professionId: null, organizationId: null, modules: [], status: "ACTIVE", mustChangePassword: false, createdAt: new Date().toISOString(),
  });
  operator = tokenSession(OPERATOR_UID, "totp");

  titularA = await registerAndSignIn(TITULAR_A);
  titularB = await registerAndSignIn(TITULAR_B);
  colleague = await seedMember(COLLEAGUE_UID, titularA.organizationId, "PROFESSIONAL");
  clinicAdmin = await seedMember(CLINIC_ADMIN_UID, titularA.organizationId, "ADMIN");

  await seedClient(titularA.organizationId, titularA.uid, SUBJECT);
  await seedClient(titularA.organizationId, titularA.uid, CONTROL);
  await seedClient(titularB.organizationId, titularB.uid, NEIGHBOR);
}, 120_000);

afterAll(async () => {
  for (const person of [titularA, titularB]) {
    if (!person) continue;
    await signOut(person.auth).catch(() => {});
    await terminate(person.db);
    await deleteApp(person.app);
  }
  await Promise.all([operator, colleague, clinicAdmin].filter(Boolean).map((session) => session.dispose()));
  await Promise.all(admin.apps.map((instance: { delete(): Promise<void> }) => instance.delete()));
});

describe("Etapa 5C — direitos do titular dos dados", () => {
  it("exporta o que a organizacao guarda sobre o cliente, e so dele", async () => {
    const orgA = titularA.organizationId;
    const exported = await titularA.call<ClientDataExport>("exportClientData", { clientId: X.client, receivedVia: "EMAIL" });

    expect(exported).toMatchObject({
      format: "atendara.titular",
      version: 1,
      organization: { id: orgA },
      subject: { id: X.client, fullName: SUBJECT.name },
    });
    expect(exported.appointments.map((item) => item.id)).toEqual([X.appointment]);
    expect(exported.conversations.map((item) => item.id)).toEqual([X.conversation]);
    expect(exported.conversations[0].messages.map((item) => item.id).sort()).toEqual([X.inbound, X.outbound].sort());
    expect(exported.transactions.map((item) => item.id)).toEqual([X.transaction]);
    expect(exported.notificationDeliveries.map((item) => item.id)).toEqual([X.delivery]);
    expect(exported.aiDecisions.map((item) => item.id)).toEqual([X.decision]);
    expect(exported.auditTrail.map((item) => item.id).sort()).toEqual(Object.values(X.audit).sort());

    // Datas saem legiveis, e nao como objeto interno do banco.
    expect(exported.subject.createdAt).toMatch(ISO);
    expect(exported.appointments[0].startsAt).toMatch(ISO);

    const text = JSON.stringify(exported);
    expect(text).not.toContain(CONTROL.name);
    expect(text).not.toContain(Y.client);
    expect(text).not.toContain("Recepcao de testes");

    expect(await data(paths.document(orgA, "privacyRequests", exported.requestId))).toMatchObject({
      type: "CLIENT_EXPORT",
      subjectId: X.client,
      receivedVia: "EMAIL",
      requestedBy: titularA.uid,
    });
    const trail = await fs().collection(paths.collection(orgA, "auditLogs")).where("metadata.requestId", "==", exported.requestId).get();
    expect(trail.docs.map((entry: { data(): { action: string; summary: string } }) => entry.data())).toEqual([
      expect.objectContaining({ action: "EXPORT", summary: expect.not.stringContaining(SUBJECT.name) }),
    ]);

    // O titular le o registro pelas regras reais.
    const own = await getDoc(doc(titularA.db, paths.document(orgA, "privacyRequests", exported.requestId)));
    expect(own.exists()).toBe(true);
  });

  it("nega exportar e eliminar a quem nao responde pela organizacao, inclusive a outro tenant", async () => {
    const orgA = titularA.organizationId;
    const payload = { clientId: X.client, receivedVia: "EMAIL" };

    // Outro tenant: o id do cliente simplesmente nao existe na organizacao dele.
    await expect(titularB.call("exportClientData", payload)).rejects.toMatchObject({ code: "not-found" });
    await expect(titularB.call("eraseClientData", payload)).rejects.toMatchObject({ code: "not-found" });
    // E nao ha como apontar a organizacao: o campo e recusado.
    await expect(titularB.call("exportClientData", { ...payload, organizationId: orgA })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(titularB.call("eraseClientData", { ...payload, organizationId: orgA })).rejects.toMatchObject({ code: "invalid-argument" });

    // Mesma organizacao, sem responsabilidade por ela.
    await expect(colleague.call("exportClientData", payload)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(colleague.call("eraseClientData", payload)).rejects.toMatchObject({ code: "permission-denied" });
    // A operadora, mesmo com TOTP, nao alcanca tenant.
    await expect(operator.call("exportClientData", payload)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(operator.call("eraseClientData", payload)).rejects.toMatchObject({ code: "permission-denied" });
    // Sem atestado do aplicativo.
    await expect(
      callFunction("exportClientData", payload, { idToken: await titularA.auth.currentUser!.getIdToken(), appCheck: false }),
    ).rejects.toMatchObject({ code: "unauthenticated" });

    // Painel vencido: exportar nao abre o que a leitura normal fecha.
    const accountRef = fs().doc(paths.account(titularA.uid));
    const validUntil = (await accountRef.get()).data().accessUntilMs;
    await accountRef.update({ accessUntilMs: 0 });
    try {
      await expect(titularA.call("exportClientData", payload)).rejects.toMatchObject({ code: "permission-denied" });
    } finally {
      await accountRef.update({ accessUntilMs: validUntil });
    }

    // Pelas regras: ninguem de fora le os registros de pedido de A.
    const requestsOfA = (db: Firestore) => getDocs(query(collection(db, paths.collection(orgA, "privacyRequests")), limit(5)));
    await expectDenied(requestsOfA(titularB.db));
    await expectDenied(requestsOfA(colleague.firestore));
    await expectDenied(requestsOfA(operator.firestore));

    expect((await fs().doc(paths.document(orgA, "clients", X.client)).get()).exists).toBe(true);

    // Papel ADMIN atende, pelo mesmo caminho.
    const byAdmin = await clinicAdmin.call<ClientDataExport>("exportClientData", { clientId: Y.client, receivedVia: "IN_PERSON" });
    expect(byAdmin.subject.id).toBe(Y.client);
  });

  it("elimina o cliente e pseudonimiza a trilha, sem apagar decisao nem auditoria", async () => {
    const orgA = titularA.organizationId;
    const at = (collectionName: keyof typeof TENANT_COLLECTIONS, id: string) => paths.document(orgA, collectionName, id);
    const decisionBefore = (await data(at("aiDecisions", X.decision)))!;
    const decisionsBefore = await sizeOf(paths.collection(orgA, "aiDecisions"));
    const auditBefore = await sizeOf(paths.collection(orgA, "auditLogs"));

    const result = await titularA.call<PrivacyOperationResult>("eraseClientData", { clientId: X.client, receivedVia: "LETTER" });

    expect(result.counts).toMatchObject({
      clients: { deleted: 1 },
      conversations: { deleted: 1 },
      messages: { deleted: 2 },
      appointments: { pseudonymized: 1 },
      aiDecisions: { pseudonymized: 1 },
      auditLogs: { pseudonymized: 5 },
      privacyRequests: { pseudonymized: 1 },
    });

    // Apagado: cadastro, conversa e mensagens.
    expect((await fs().doc(at("clients", X.client)).get()).exists).toBe(false);
    expect((await fs().doc(at("conversations", X.conversation)).get()).exists).toBe(false);
    expect(await sizeOf(messagesPath(orgA, X.conversation))).toBe(0);

    // Append-only: nenhuma decisao sumiu, e a trilha ganhou so o registro do pedido.
    expect(await sizeOf(paths.collection(orgA, "aiDecisions"))).toBe(decisionsBefore);
    expect(await sizeOf(paths.collection(orgA, "auditLogs"))).toBe(auditBefore + 1);

    const decision = (await data(at("aiDecisions", X.decision)))!;
    subjectPseudonym = decision.clientId;
    expect(subjectPseudonym.startsWith(PSEUDONYM_PREFIX)).toBe(true);
    for (const field of ["classification", "confidence", "appliedRules", "action", "reason", "attention", "escalated", "engineVersion", "conversationId", "messageId", "latencyMs"]) {
      expect(decision[field], field).toEqual(decisionBefore[field]);
    }
    expect(decision.decidedAt.isEqual(decisionBefore.decidedAt)).toBe(true);
    expect(decision).toMatchObject({
      inputPreview: REDACTED_TEXT,
      responseText: REDACTED_TEXT,
      privacyRedaction: { scope: "CLIENT_ERASURE", requestId: result.requestId },
    });

    expect(await data(at("appointments", X.appointment))).toMatchObject({
      clientId: subjectPseudonym, clientName: REDACTED_NAME, administrativeNotes: null, priceInCents: 20_000, status: "COMPLETED",
    });
    expect(await data(at("transactions", X.transaction))).toMatchObject({
      clientId: subjectPseudonym, clientName: null, description: REDACTED_TEXT, amountInCents: 20_000, status: "PAID",
    });
    expect(await data(at("notificationDeliveries", X.delivery))).toMatchObject({
      clientId: subjectPseudonym, contactHint: MASKED_CONTACT, status: "SENT", bodyHash: "abcdef12",
    });
    expect(await data(at("notifications", X.notification))).toMatchObject({ title: REDACTED_TEXT, body: REDACTED_TEXT });
    expect(await data(at("auditLogs", X.audit.client))).toMatchObject({
      summary: REDACTED_TEXT, resource: { type: "client", id: subjectPseudonym }, actorName: "Recepcao de testes",
    });
    expect(await data(at("auditLogs", X.audit.appointment))).toMatchObject({
      summary: REDACTED_TEXT, resource: { type: "appointment", id: X.appointment },
    });

    // O registro da exportacao anterior deixou de apontar para a pessoa.
    const requests = (await fs().collection(paths.collection(orgA, "privacyRequests")).get()).docs.map(
      (entry: { data(): Record<string, unknown> }) => entry.data(),
    );
    expect(requests.some((entry: Record<string, unknown>) => entry.subjectId === X.client)).toBe(false);
    expect(requests.find((entry: Record<string, unknown>) => entry.id === result.requestId)).toMatchObject({
      type: "CLIENT_ERASURE", subjectId: subjectPseudonym, receivedVia: "LETTER",
    });

    // Nenhum documento da organizacao guarda o nome ou o id do titular.
    const dump = JSON.stringify(await tenantDump(orgA));
    expect(dump).not.toContain(SUBJECT.name);
    expect(dump).not.toContain(`"${X.client}"`);

    // O cadastro de controle nao foi tocado.
    expect(await data(at("clients", Y.client))).toMatchObject({ fullName: CONTROL.name });
    expect((await data(at("aiDecisions", Y.decision)))!.inputPreview).toContain(CONTROL.name);
    expect((await data(at("auditLogs", Y.audit.client)))!.summary).toContain(CONTROL.name);

    // Pelo cliente, a trilha pseudonimizada continua imutavel.
    await expectDenied(updateDoc(doc(titularA.db, at("aiDecisions", X.decision)), { inputPreview: "restaurado" }));
    // Repetir o pedido nao encontra mais o cadastro.
    await expect(titularA.call("eraseClientData", { clientId: X.client, receivedVia: "LETTER" })).rejects.toMatchObject({ code: "not-found" });
  });

  it("exporta a organizacao inteira em paginas, so a partir de um inicio registrado", async () => {
    const orgA = titularA.organizationId;
    const start = await titularA.call<OrganizationExportStart>("startOrganizationExport", {});
    expect(start.organization).toMatchObject({ id: orgA, name: TITULAR_A.name });
    expect(await data(paths.document(orgA, "privacyRequests", start.exportId))).toMatchObject({
      type: "ORGANIZATION_EXPORT", requestedBy: titularA.uid, subjectId: null,
    });

    const collected: Record<string, OrganizationExportPage["documents"]> = {};
    for (const section of start.sections) {
      collected[section] = [];
      let cursor: OrganizationExportCursor | null = null;
      do {
        const page: OrganizationExportPage = await titularA.call<OrganizationExportPage>("exportOrganizationPage", {
          exportId: start.exportId, section, cursor, pageSize: 1,
        });
        collected[section].push(...page.documents);
        cursor = page.nextCursor;
      } while (cursor);
    }

    expect(collected.clients.map((item) => item.id)).toEqual([Y.client]);
    expect(collected.members.map((item) => item.id).sort()).toEqual([titularA.uid, COLLEAGUE_UID, CLINIC_ADMIN_UID].sort());
    expect(collected.messages.map((item) => item.id).sort()).toEqual([Y.inbound, Y.outbound].sort());
    expect(collected.messages.every((item) => item.conversationId === Y.conversation)).toBe(true);
    expect(collected.appointments.find((item) => item.id === X.appointment)?.data).toMatchObject({ clientName: REDACTED_NAME });
    expect(collected.auditLogs).toHaveLength(await sizeOf(paths.collection(orgA, "auditLogs")));
    expect(collected.appointments[0].data.startsAt).toMatch(ISO);
    expect(JSON.stringify(collected)).not.toContain(NEIGHBOR.name);

    // Pagina sem inicio registrado, de outra pessoa ou de outro tenant: nada.
    await expect(titularA.call("exportOrganizationPage", { exportId: "exportacao-forjada", section: "clients" })).rejects.toMatchObject({ code: "not-found" });
    await expect(clinicAdmin.call("exportOrganizationPage", { exportId: start.exportId, section: "clients" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(titularB.call("exportOrganizationPage", { exportId: start.exportId, section: "clients" })).rejects.toMatchObject({ code: "not-found" });
    await expect(operator.call("startOrganizationExport", {})).rejects.toMatchObject({ code: "permission-denied" });
    await expect(colleague.call("startOrganizationExport", {})).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("so o titular exclui a organizacao, com login recente e sem assinatura viva", async () => {
    const orgA = titularA.organizationId;
    const confirm = { confirmOrganizationId: orgA };

    // B nao aponta a organizacao de A: a confirmacao nao bate com a dele.
    await expect(titularB.call("deleteOrganization", confirm)).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(clinicAdmin.call("deleteOrganization", confirm)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(operator.call("deleteOrganization", confirm)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(titularA.call("deleteOrganization", { confirmOrganizationId: titularB.organizationId })).rejects.toMatchObject({
      code: "failed-precondition",
    });

    const stale = tokenSession(titularA.uid, null, { signedInSecondsAgo: 3_600 });
    try {
      await expect(stale.call("deleteOrganization", confirm)).rejects.toMatchObject({ code: "unauthenticated" });
    } finally {
      await stale.dispose();
    }

    await fs().doc(paths.platformSubscription(orgA)).set({
      organizationId: orgA, subscriberUserId: titularA.uid, subscriberEmail: TITULAR_A.email, planId: "profissional-mensal",
      status: "ACTIVE", amountInCents: 19_900, currency: "BRL", interval: "MONTH",
    });
    await expect(titularA.call("deleteOrganization", confirm)).rejects.toMatchObject({ code: "failed-precondition" });

    expect(await data(paths.organization(orgA))).toMatchObject({ name: TITULAR_A.name, ownerId: titularA.uid });
    expect(await data(paths.document(orgA, "clients", Y.client))).toMatchObject({ fullName: CONTROL.name });
  });

  it("exclui a organizacao: tenant apagado, trilha pseudonimizada, acesso encerrado, vizinho intacto", async () => {
    const orgA = titularA.organizationId;
    const orgB = titularB.organizationId;
    await fs().doc(paths.platformSubscription(orgA)).update({ status: "CANCELED" });

    const result = await titularA.call<PrivacyOperationResult>("deleteOrganization", { confirmOrganizationId: orgA });

    for (const name of ["members", "professionals", "clients", "appointments", "conversations", "transactions", "aiRules", "notifications", "notificationDeliveries"] as const) {
      expect(await sizeOf(paths.collection(orgA, name)), name).toBe(0);
    }
    expect((await fs().collectionGroup("messages").where("organizationId", "==", orgA).get()).size).toBe(0);

    // A trilha fica, sem pessoa, com prazo provisorio gravado.
    const decisions = (await fs().collection(paths.collection(orgA, "aiDecisions")).get()).docs.map(
      (entry: { id: string; data(): Stored }) => ({ id: entry.id, ...entry.data() }),
    );
    expect(decisions).toHaveLength(2);
    for (const decision of decisions) {
      expect(decision.clientId.startsWith(PSEUDONYM_PREFIX)).toBe(true);
      expect(decision.privacyRedaction).toMatchObject({ scope: "ORGANIZATION_DELETION", requestId: result.requestId });
      expect(decision.expiresAt).toBeDefined();
    }
    // O pseudonimo da eliminacao individual e preservado.
    expect(decisions.find((decision: { id: string }) => decision.id === X.decision).clientId).toBe(subjectPseudonym);

    const trail = (await fs().collection(paths.collection(orgA, "auditLogs")).get()).docs.map(
      (entry: { data(): Stored }) => entry.data(),
    );
    expect(trail.length).toBeGreaterThan(0);
    for (const entry of trail) expect(entry).toMatchObject({ actorName: REDACTED_NAME, summary: REDACTED_TEXT });

    const dump = JSON.stringify(await tenantDump(orgA));
    for (const personal of [SUBJECT.name, CONTROL.name, TITULAR_A.name, TITULAR_A.email, "Recepcao de testes"]) {
      expect(dump, personal).not.toContain(personal);
    }

    // Lapide: sem nome, dono nem configuracao.
    const tombstone = (await data(paths.organization(orgA)))!;
    expect(tombstone).toMatchObject({ id: orgA, deletion: { status: "DONE", requestId: result.requestId } });
    expect(tombstone.name).toBeUndefined();
    expect(tombstone.ownerId).toBeUndefined();

    // Acesso encerrado: contas, verificadores e usuario do Auth.
    for (const uid of [titularA.uid, COLLEAGUE_UID, CLINIC_ADMIN_UID]) {
      expect((await fs().doc(paths.account(uid)).get()).exists, uid).toBe(false);
    }
    await expect(admin.auth().getUser(titularA.uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
    await expectDenied(getDoc(doc(titularA.db, paths.document(orgA, "aiDecisions", Y.decision))));

    // Plataforma: e-mail fora da assinatura, registro do ato na trilha dela.
    expect(await data(paths.platformSubscription(orgA))).toMatchObject({ subscriberEmail: null, status: "CANCELED" });
    const platformTrail = await fs().collection(paths.platformAuditLogs()).where("organizationId", "==", orgA).get();
    expect(platformTrail.docs.map((entry: { data(): Record<string, unknown> }) => entry.data())).toContainEqual(
      expect.objectContaining({ action: "ORGANIZATION_DELETED", actorId: titularA.uid, targetUserId: titularA.uid }),
    );

    // O tenant vizinho continua inteiro e acessivel ao proprio titular.
    expect(await data(paths.organization(orgB))).toMatchObject({ name: TITULAR_B.name });
    expect((await fs().doc(paths.account(titularB.uid)).get()).exists).toBe(true);
    const neighbor = await getDoc(doc(titularB.db, paths.document(orgB, "clients", Z.client)));
    expect(neighbor.data()).toMatchObject({ fullName: NEIGHBOR.name });
    await expectDenied(getDoc(doc(titularB.db, paths.organization(orgA))));
  });
});
