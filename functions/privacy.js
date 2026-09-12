import { getAuth } from "firebase-admin/auth";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { messagePath, messagesPath, paths, TENANT_COLLECTIONS } from "./generated/paths.js";
import { ORGANIZATION_EXPORT_SECTIONS, PRIVACY_REQUEST_CHANNELS } from "./generated/privacy-types.js";
import {
  ORGANIZATION_EXPORT_PAGE_SIZE,
  ORGANIZATION_EXPORT_WINDOW_MINUTES,
  PERSONAL_DATA_MAP,
  PRIVACY_RESPONSIBLE_ROLES,
  PROVISIONAL_PRIVACY_RETENTION_DAYS,
  RECENT_LOGIN_SECONDS,
} from "./generated/privacy-config.js";
import { pseudonymFrom, redactionPatch } from "./generated/privacy-redaction.js";
import { ACCOUNT_CALL_OPTIONS, accountOf, parse } from "./platform-auth.js";
import { auditEntry } from "./platform.js";
import { consumeRateLimit } from "./rate-limit.js";

/**
 * Direitos do titular dos dados, pelo backend.
 *
 * Tres garantias que este arquivo existe para sustentar:
 *
 * 1. **Ninguem escolhe a organizacao.** Como na cobranca, nenhuma callable
 *    aceita `organizationId`: ele sai de `accounts/{uid}` no servidor. Um
 *    `clientId` de outro tenant e simplesmente um cadastro que nao existe aqui.
 * 2. **A trilha nao some.** `aiDecisions` e `auditLogs` sao pseudonimizados,
 *    nunca apagados, e so nos campos que `src/config/privacy.ts` lista. O que
 *    cada colecao sofre vem do mapa — este arquivo nao decide destino de dado.
 * 3. **Todo pedido deixa registro.** Exportacao e eliminacao gravam
 *    `privacyRequests` e uma entrada em `auditLogs`; a exclusao da organizacao,
 *    que leva o tenant junto, grava em `platformAuditLogs`.
 *
 * O que NAO esta aqui: prazo legal, excecao a eliminacao e base legal. Sao
 * pontos juridicos em aberto, e o mapa esta marcado como tal.
 */

const DAY_MS = 86_400_000;
const IN_QUERY_LIMIT = 30;
const PSEUDONYMIZE_PAGE = 300;

// Excluir uma organizacao percorre o tenant inteiro; os 60 s padrao nao cabem
// numa clinica com historico.
const PRIVACY_CALL_OPTIONS = { ...ACCOUNT_CALL_OPTIONS, timeoutSeconds: 540 };

const db = () => getFirestore();

// ---------------------------------------------------------------- utilitarios

/**
 * Saida para arquivo: `Timestamp` do SDK administrativo vira ISO-8601. So nesta
 * direcao e so para o que vai embora na resposta — a conversao do dominio
 * continua exclusiva de `src/lib/firebase/converters.ts`.
 */
function portable(value) {
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(portable);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portable(item)]));
}

const withId = (snapshot) => ({ id: snapshot.id, ...portable(snapshot.data()) });

function counter() {
  const counts = {};
  const add = (collection, kind, amount = 1) => {
    counts[collection] ??= { exported: 0, deleted: 0, pseudonymized: 0 };
    counts[collection][kind] += amount;
  };
  return { counts, add };
}

/** Erros de cada escrita, capturados na hora para nao virar rejeicao solta. */
function tracked(promise) {
  return promise.then(() => null, (error) => error);
}

async function settle(writer, results) {
  await writer.close();
  const failure = (await Promise.all(results)).find(Boolean);
  if (failure) throw failure;
}

// ---------------------------------------------------------------- autorizacao

/**
 * Quem atende pedido de titular: conta profissional com o painel aberto,
 * vinculo ativo e responsabilidade pela organizacao — papel OWNER/ADMIN ou o
 * titular (`ownerId`). E o mesmo portao de `activeAccount()` e `isMember()` nas
 * rules, mais `privacyResponsible()`: exportar nao abre a quem esta com o
 * acesso vencido um caminho que a leitura normal fecharia.
 */
async function responsibleMember(request) {
  const account = await accountOf(request);
  if (account.platformRole !== "PROFESSIONAL" || account.mustChangePassword || !account.organizationId) {
    throw new HttpsError("permission-denied", "Somente quem responde por uma organizacao atende pedidos de titulares.");
  }
  if (account.subscriptionStatus !== "ACTIVE" || !(account.accessUntilMs > Date.now())) {
    throw new HttpsError("permission-denied", "O acesso desta organizacao nao esta vigente.");
  }

  const organizationId = account.organizationId;
  const [organizationSnapshot, memberSnapshot] = await Promise.all([
    db().doc(paths.organization(organizationId)).get(),
    db().doc(paths.document(organizationId, "members", request.auth.uid)).get(),
  ]);
  const organization = organizationSnapshot.data();
  const member = memberSnapshot.data();
  if (
    !organization ||
    organization.deletion ||
    organization.primaryProfession !== account.professionId ||
    member?.status !== "ACTIVE"
  ) {
    throw new HttpsError("permission-denied", "Cadastro sem vinculo ativo com a organizacao.");
  }
  if (organization.ownerId !== request.auth.uid && !PRIVACY_RESPONSIBLE_ROLES.includes(member.role)) {
    throw new HttpsError("permission-denied", "Somente quem responde pela organizacao atende pedidos de titulares.");
  }
  return { account, organizationId, organization };
}

// ---------------------------------------------------------------- registros

function privacyRequestRecord({ id, organizationId, type, subjectId, receivedVia, actorId, counts, at }) {
  return {
    ref: db().doc(paths.document(organizationId, "privacyRequests", id)),
    data: {
      id,
      organizationId,
      type,
      subjectId,
      receivedVia,
      requestedBy: actorId,
      executedAt: at,
      counts,
      createdAt: at,
      updatedAt: at,
      createdBy: actorId,
      updatedBy: actorId,
      // Prazo provisorio, sem TTL ligado (ver `src/config/privacy.ts`).
      expiresAt: new Date(at.getTime() + PROVISIONAL_PRIVACY_RETENTION_DAYS.privacyRequests * DAY_MS),
    },
  };
}

/** Entrada da trilha do tenant, no mesmo formato que o aplicativo grava. */
function tenantAuditEntry({ organizationId, actorId, actorName, action, resource, summary, requestId, at }) {
  const id = randomUUID();
  return {
    ref: db().doc(paths.document(organizationId, "auditLogs", id)),
    data: {
      id,
      organizationId,
      actorType: "USER",
      actorId,
      actorName,
      action,
      resource,
      // Resumo sem nome de ninguem: a trilha do pedido nao pode guardar o que
      // o pedido eliminou.
      summary,
      metadata: { requestId },
      occurredAt: at,
      createdAt: at,
      updatedAt: at,
      createdBy: actorId,
      updatedBy: actorId,
    },
  };
}

// ---------------------------------------------------------------- busca

async function inChunks(collection, field, values) {
  const unique = [...new Set(values)];
  const found = new Map();
  for (let index = 0; index < unique.length; index += IN_QUERY_LIMIT) {
    const snapshot = await collection.where(field, "in", unique.slice(index, index + IN_QUERY_LIMIT)).get();
    for (const document of snapshot.docs) found.set(document.ref.path, document);
  }
  return [...found.values()];
}

/**
 * Tudo o que a organizacao guarda sobre um cliente.
 *
 * A busca parte do `clientId` e segue os ids que dele derivam: a trilha e os
 * alertas apontam para atendimento, lancamento e conversa, e o resumo deles e
 * montado com o nome da pessoa ("Atendimento de ... agendado").
 */
async function linkedToClient(organizationId, clientId) {
  const tenant = (name) => db().collection(paths.collection(organizationId, name));
  const byClient = (name) => tenant(name).where("clientId", "==", clientId).get().then((snapshot) => snapshot.docs);

  const [appointments, conversations, transactions, notificationDeliveries, aiDecisions, privacyRequests] = await Promise.all([
    byClient("appointments"),
    byClient("conversations"),
    byClient("transactions"),
    byClient("notificationDeliveries"),
    byClient("aiDecisions"),
    tenant("privacyRequests").where("subjectId", "==", clientId).get().then((snapshot) => snapshot.docs),
  ]);
  const messages = (
    await Promise.all(conversations.map((conversation) => db().collection(messagesPath(organizationId, conversation.id)).get()))
  ).flatMap((snapshot) => snapshot.docs);

  const relatedIds = [clientId, ...[appointments, conversations, messages, transactions, notificationDeliveries, aiDecisions].flat().map((document) => document.id)];
  const [auditLogs, byTarget, byDecision] = await Promise.all([
    inChunks(tenant("auditLogs"), "resource.id", relatedIds),
    inChunks(tenant("notifications"), "target.id", relatedIds),
    inChunks(tenant("notifications"), "aiDecisionId", aiDecisions.map((document) => document.id)),
  ]);
  const notifications = [...new Map([...byTarget, ...byDecision].map((document) => [document.ref.path, document])).values()];

  return { appointments, conversations, messages, transactions, notificationDeliveries, aiDecisions, auditLogs, notifications, privacyRequests };
}

// ---------------------------------------------------------------- cliente

const clientRequest = z
  .object({ clientId: z.string().min(1).max(128), receivedVia: z.enum(PRIVACY_REQUEST_CHANNELS) })
  .strict();

async function existingClient(organizationId, clientId) {
  const snapshot = await db().doc(paths.document(organizationId, "clients", clientId)).get();
  // Mesma resposta para "nao existe" e "e de outra organizacao": o id de um
  // cliente alheio nao revela nada.
  if (!snapshot.exists) throw new HttpsError("not-found", "Cadastro nao encontrado nesta organizacao.");
  return snapshot;
}

/** Copia do que a organizacao guarda sobre uma pessoa, para entregar a ela. */
export const exportClientData = onCall(PRIVACY_CALL_OPTIONS, async (request) => {
  const { account, organizationId, organization } = await responsibleMember(request);
  const input = parse(clientRequest, request.data);
  const client = await existingClient(organizationId, input.clientId);
  const linked = await linkedToClient(organizationId, input.clientId);

  const at = new Date();
  const requestId = randomUUID();
  const messagesOf = (conversationId) =>
    linked.messages.filter((message) => message.ref.parent.parent.id === conversationId).map(withId);

  const result = {
    format: "nexo.titular",
    version: 1,
    requestId,
    generatedAt: at.toISOString(),
    organization: { id: organizationId, name: organization.name ?? null },
    subject: withId(client),
    appointments: linked.appointments.map(withId),
    conversations: linked.conversations.map((conversation) => ({ ...withId(conversation), messages: messagesOf(conversation.id) })),
    transactions: linked.transactions.map(withId),
    notificationDeliveries: linked.notificationDeliveries.map(withId),
    aiDecisions: linked.aiDecisions.map(withId),
    // Sem o nome de quem registrou: e dado da equipe, nao do titular.
    auditTrail: linked.auditLogs.map((entry) => {
      const data = portable(entry.data());
      return {
        id: entry.id,
        action: data.action ?? null,
        occurredAt: data.occurredAt ?? null,
        resourceType: data.resource?.type ?? null,
        summary: data.summary ?? null,
      };
    }),
  };

  const { counts, add } = counter();
  add("clients", "exported");
  for (const name of ["appointments", "conversations", "messages", "transactions", "notificationDeliveries", "aiDecisions", "auditLogs"]) {
    add(name, "exported", linked[name].length);
  }

  const record = privacyRequestRecord({ id: requestId, organizationId, type: "CLIENT_EXPORT", subjectId: input.clientId, receivedVia: input.receivedVia, actorId: request.auth.uid, counts, at });
  const audit = tenantAuditEntry({ organizationId, actorId: request.auth.uid, actorName: account.displayName, action: "EXPORT", resource: { type: "client", id: input.clientId }, summary: "Dados de titular exportados a pedido.", requestId, at });
  // O registro vai antes da resposta: sem ele gravado, nada e entregue.
  const batch = db().batch();
  batch.create(record.ref, record.data);
  batch.create(audit.ref, audit.data);
  await batch.commit();

  return result;
});

/**
 * Eliminacao a pedido do titular.
 *
 * Cadastro, conversas e mensagens sao apagados. Agenda, financeiro, alertas,
 * registros de envio, decisoes do agente e trilha continuam existindo, sem o
 * que identifica a pessoa — o destino de cada um esta no mapa.
 */
export const eraseClientData = onCall(PRIVACY_CALL_OPTIONS, async (request) => {
  const { account, organizationId } = await responsibleMember(request);
  const input = parse(clientRequest, request.data);
  await consumeRateLimit(request.auth.uid, "eraseClientData");
  const client = await existingClient(organizationId, input.clientId);
  const linked = await linkedToClient(organizationId, input.clientId);

  // A mesma trava de excluir cadastro pela interface (`planDeleteClient`).
  // Pendencia em aberto e resolvida antes, por quem cobra — sem nome no
  // lancamento, depois nao haveria de quem cobrar.
  if (linked.transactions.some((transaction) => ["PENDING", "OVERDUE"].includes(transaction.data().status))) {
    throw new HttpsError("failed-precondition", "Ha pendencias financeiras em aberto para este cadastro. Receba, cancele ou estorne antes de eliminar.");
  }

  const at = new Date();
  const requestId = randomUUID();
  // Aleatorio, e nao derivado do id: quem guardou o `clientId` nao recalcula.
  const pseudonym = pseudonymFrom(randomUUID());
  const context = {
    mark: { scope: "CLIENT_ERASURE", requestId, redactedAt: at.toISOString() },
    pseudonymOf: (clientId) => (clientId === input.clientId ? pseudonym : null),
  };

  const { counts, add } = counter();
  const writer = db().bulkWriter();
  const results = [];
  for (const collection of ["messages", "conversations", "appointments", "transactions", "notificationDeliveries", "notifications", "aiDecisions", "auditLogs", "privacyRequests"]) {
    const treatment = PERSONAL_DATA_MAP[collection].onClientErasure;
    for (const document of linked[collection]) {
      if (treatment.action === "DELETE") {
        results.push(tracked(writer.delete(document.ref)));
        add(collection, "deleted");
        continue;
      }
      const patch = redactionPatch(treatment, document.data(), context);
      if (!patch) continue;
      results.push(tracked(writer.update(document.ref, patch)));
      add(collection, "pseudonymized");
    }
  }
  await settle(writer, results);

  add("clients", "deleted");
  const record = privacyRequestRecord({ id: requestId, organizationId, type: "CLIENT_ERASURE", subjectId: pseudonym, receivedVia: input.receivedVia, actorId: request.auth.uid, counts, at });
  const audit = tenantAuditEntry({ organizationId, actorId: request.auth.uid, actorName: account.displayName, action: "DELETE", resource: { type: "client", id: pseudonym }, summary: "Dados de titular eliminados ou pseudonimizados a pedido.", requestId, at });
  // Por ultimo e juntos: se algo acima falhar, o cadastro continua existindo e
  // o pedido pode ser repetido.
  const batch = db().batch();
  batch.delete(client.ref);
  batch.create(record.ref, record.data);
  batch.create(audit.ref, audit.data);
  await batch.commit();

  return { requestId, counts };
});

// ---------------------------------------------------------------- organizacao

/**
 * Inicio da exportacao completa. Grava o registro e devolve o id que TODA
 * pagina precisa apresentar — pular o inicio nao pula o registro.
 */
export const startOrganizationExport = onCall(PRIVACY_CALL_OPTIONS, async (request) => {
  const { account, organizationId, organization } = await responsibleMember(request);
  parse(z.object({}).strict(), request.data ?? {});

  const at = new Date();
  const requestId = randomUUID();
  const record = privacyRequestRecord({ id: requestId, organizationId, type: "ORGANIZATION_EXPORT", subjectId: null, receivedVia: null, actorId: request.auth.uid, counts: {}, at });
  const audit = tenantAuditEntry({ organizationId, actorId: request.auth.uid, actorName: account.displayName, action: "EXPORT", resource: { type: "organization", id: organizationId }, summary: "Exportacao completa da organizacao iniciada.", requestId, at });
  const batch = db().batch();
  batch.create(record.ref, record.data);
  batch.create(audit.ref, audit.data);
  await batch.commit();

  return { exportId: requestId, organization: { id: organizationId, ...portable(organization) }, sections: [...ORGANIZATION_EXPORT_SECTIONS] };
});

const pageRequest = z
  .object({
    exportId: z.string().min(1).max(128),
    section: z.enum(ORGANIZATION_EXPORT_SECTIONS),
    cursor: z.object({ id: z.string().min(1).max(128), conversationId: z.string().min(1).max(128).optional() }).strict().nullable().optional(),
    pageSize: z.number().int().min(1).max(ORGANIZATION_EXPORT_PAGE_SIZE.max).optional(),
  })
  .strict();

/**
 * Uma pagina de uma secao. Paginado para caber na resposta de uma callable e
 * para nao deixar arquivo de exportacao guardado em lugar nenhum: o navegador
 * monta o arquivo e o servidor nao retem copia.
 */
export const exportOrganizationPage = onCall(PRIVACY_CALL_OPTIONS, async (request) => {
  const { organizationId } = await responsibleMember(request);
  const input = parse(pageRequest, request.data);

  const started = (await db().doc(paths.document(organizationId, "privacyRequests", input.exportId)).get()).data();
  if (!started || started.type !== "ORGANIZATION_EXPORT") {
    throw new HttpsError("not-found", "Exportacao nao encontrada. Inicie uma nova.");
  }
  if (started.requestedBy !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Esta exportacao foi iniciada por outra pessoa.");
  }
  if (started.executedAt.toMillis() + ORGANIZATION_EXPORT_WINDOW_MINUTES * 60_000 < Date.now()) {
    throw new HttpsError("failed-precondition", "Esta exportacao expirou. Inicie uma nova.");
  }

  const size = input.pageSize ?? ORGANIZATION_EXPORT_PAGE_SIZE.default;
  const isMessages = input.section === "messages";
  let query;
  if (isMessages) {
    // Mensagens atravessam as conversas; o filtro de tenant e o mesmo da caixa
    // de entrada e usa o indice que ja existe.
    query = db().collectionGroup("messages").where("organizationId", "==", organizationId).orderBy("sentAt", "desc");
    if (input.cursor) {
      if (!input.cursor.conversationId) throw new HttpsError("invalid-argument", "Confira os dados informados.");
      const last = await db().doc(messagePath(organizationId, input.cursor.conversationId, input.cursor.id)).get();
      if (!last.exists) throw new HttpsError("failed-precondition", "A exportacao mudou durante a leitura. Inicie uma nova.");
      query = query.startAfter(last);
    }
  } else {
    query = db().collection(paths.collection(organizationId, input.section)).orderBy(FieldPath.documentId());
    if (input.cursor) query = query.startAfter(input.cursor.id);
  }

  const snapshot = await query.limit(size).get();
  const conversationOf = (document) => document.ref.parent.parent.id;
  const documents = snapshot.docs.map((document) => ({
    id: document.id,
    ...(isMessages ? { conversationId: conversationOf(document) } : {}),
    data: portable(document.data()),
  }));
  const last = snapshot.docs.at(-1);
  const nextCursor =
    snapshot.size === size && last ? { id: last.id, ...(isMessages ? { conversationId: conversationOf(last) } : {}) } : null;

  return { section: input.section, documents, nextCursor };
});

async function deleteRecursively(collection) {
  const writer = db().bulkWriter();
  let deleted = 0;
  writer.onWriteResult(() => {
    deleted += 1;
  });
  await db().recursiveDelete(collection, writer);
  await writer.close();
  return deleted;
}

async function pseudonymizeCollection(collection, treatment, context, extra) {
  let changed = 0;
  let after = null;
  for (;;) {
    let query = collection.orderBy(FieldPath.documentId()).limit(PSEUDONYMIZE_PAGE);
    if (after) query = query.startAfter(after);
    const page = await query.get();
    if (page.empty) break;

    const writer = db().bulkWriter();
    const results = [];
    for (const document of page.docs) {
      const patch = redactionPatch(treatment, document.data(), context);
      if (!patch) continue;
      results.push(tracked(writer.update(document.ref, { ...patch, ...extra })));
      changed += 1;
    }
    await settle(writer, results);

    if (page.size < PSEUDONYMIZE_PAGE) break;
    after = page.docs.at(-1).id;
  }
  return changed;
}

/**
 * Conta, verificador de senha inicial, indice e usuario do Auth de um membro.
 * So se a conta for profissional DESTA organizacao: um id de membro nunca
 * derruba conta de outro tenant nem a da operadora.
 */
async function removeAccess(userId, organizationId) {
  const accountRef = db().doc(paths.account(userId));
  const account = (await accountRef.get()).data();
  if (!account || account.platformRole !== "PROFESSIONAL" || account.organizationId !== organizationId) return false;

  const batch = db().batch();
  batch.delete(accountRef);
  batch.delete(db().doc(paths.initialPassword(userId)));
  batch.delete(db().doc(paths.userMembership(userId)));
  await batch.commit();
  try {
    await getAuth().deleteUser(userId);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
  }
  return true;
}

const deletionRequest = z.object({ confirmOrganizationId: z.string().min(1).max(128) }).strict();

/**
 * Exclusao da organizacao pelo titular.
 *
 * Nao exige painel aberto: quem parou de pagar tambem pode encerrar. Exige o
 * titular (`ownerId`), login recente, a confirmacao do id e nenhuma assinatura
 * viva — assinatura viva continuaria cobrando o cartao, e cancelar e decisao
 * pelo caminho da cobranca, nao efeito colateral daqui.
 */
export const deleteOrganization = onCall(PRIVACY_CALL_OPTIONS, async (request) => {
  const account = await accountOf(request);
  if (account.platformRole !== "PROFESSIONAL" || account.mustChangePassword || !account.organizationId) {
    throw new HttpsError("permission-denied", "Somente o titular exclui a propria organizacao.");
  }
  const input = parse(deletionRequest, request.data);
  const organizationId = account.organizationId;
  const organizationRef = db().doc(paths.organization(organizationId));
  const organization = (await organizationRef.get()).data();
  if (!organization || organization.deletion?.status === "DONE") {
    throw new HttpsError("not-found", "Organizacao nao encontrada.");
  }
  // O titular, e so ele: um OWNER promovido gerencia a organizacao, mas nao a
  // encerra — do mesmo modo que nao contrata a assinatura.
  if (organization.ownerId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Somente o titular exclui a organizacao.");
  }
  if (input.confirmOrganizationId !== organizationId) {
    throw new HttpsError("failed-precondition", "A confirmacao nao corresponde a esta organizacao.");
  }
  if (Date.now() / 1000 - request.auth.token.auth_time > RECENT_LOGIN_SECONDS) {
    throw new HttpsError("unauthenticated", "Entre novamente para excluir a organizacao.");
  }
  await consumeRateLimit(request.auth.uid, "deleteOrganization");

  const subscriptionRef = db().doc(paths.platformSubscription(organizationId));
  const subscription = (await subscriptionRef.get()).data();
  if (subscription && subscription.status !== "CANCELED") {
    throw new HttpsError("failed-precondition", "Cancele a assinatura antes de excluir a organizacao.");
  }

  const at = new Date();
  const requestId = organization.deletion?.requestId ?? randomUUID();
  const startedAt = organization.deletion?.startedAt ?? at.toISOString();
  // A marca vem primeiro: se algo falhar no meio, a organizacao ja nao e usada,
  // e repetir o pedido retoma com o mesmo id, sem pseudonimizar duas vezes.
  await organizationRef.update({ deletion: { status: "IN_PROGRESS", requestId, requestedBy: request.auth.uid, startedAt } });

  const pseudonyms = new Map();
  const context = {
    mark: { scope: "ORGANIZATION_DELETION", requestId, redactedAt: at.toISOString() },
    pseudonymOf: (clientId) => {
      if (!pseudonyms.has(clientId)) pseudonyms.set(clientId, pseudonymFrom(randomUUID()));
      return pseudonyms.get(clientId);
    },
  };
  const trailExpiresAt = new Date(at.getTime() + PROVISIONAL_PRIVACY_RETENTION_DAYS.deletedOrganizationTrail * DAY_MS);
  const { counts, add } = counter();

  const memberIds = (await db().collection(paths.collection(organizationId, "members")).get()).docs.map((member) => member.id);

  // Vinculos primeiro: sem membro, as rules fecham o tenant para todo mundo
  // antes de o resto sair. `messages` e subcolecao e vai junto das conversas.
  const order = ["members", ...Object.keys(TENANT_COLLECTIONS).filter((name) => name !== "members" && name !== "messages")];
  for (const name of order) {
    const treatment = PERSONAL_DATA_MAP[name].onOrganizationDeletion;
    const collection = db().collection(paths.collection(organizationId, name));
    if (treatment.action === "DELETE") {
      add(name, "deleted", await deleteRecursively(collection));
    } else if (treatment.action === "PSEUDONYMIZE") {
      add(name, "pseudonymized", await pseudonymizeCollection(collection, treatment, context, { expiresAt: trailExpiresAt }));
    }
  }

  // Plataforma: so o que o mapa manda tirar. Faturas, eventos e trilha ficam,
  // com o motivo escrito no mapa.
  if (subscription) {
    const patch = redactionPatch(PERSONAL_DATA_MAP.platformSubscriptions.onOrganizationDeletion, subscription, context);
    if (patch) {
      await subscriptionRef.update(patch);
      add("platformSubscriptions", "pseudonymized");
    }
  }

  for (const userId of memberIds.filter((id) => id !== request.auth.uid)) {
    if (await removeAccess(userId, organizationId)) add("accounts", "deleted");
  }
  // Contada antes de acontecer: a conta de quem pede sai depois do registro.
  add("accounts", "deleted");

  const entry = auditEntry({
    action: "ORGANIZATION_DELETED",
    actorId: request.auth.uid,
    organizationId,
    targetUserId: request.auth.uid,
    details: { requestId, counts },
    createdAt: at.toISOString(),
  });
  const batch = db().batch();
  // Lapide: sem nome, dono, profissao nem configuracao. Fica para que a trilha
  // pseudonimizada continue tendo onde morar ate o prazo provisorio.
  batch.set(organizationRef, {
    id: organizationId,
    deletion: { status: "DONE", requestId, startedAt, completedAt: new Date().toISOString() },
    expiresAt: trailExpiresAt,
  });
  batch.create(entry.ref, entry.data);
  await batch.commit();

  // Por ultimo a conta de quem pediu: enquanto ela existe, o pedido pode ser
  // repetido.
  await removeAccess(request.auth.uid, organizationId);

  return { requestId, counts };
});
