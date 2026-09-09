import {
  collection,
  collectionGroup,
  doc,
  limit,
  orderBy,
  query,
  where,
  type DocumentReference,
  type Firestore,
  type Query,
} from "firebase/firestore";

import { messagesPath, paths, type TenantCollection } from "@/lib/firebase/paths";
import type { ID } from "@/types";

/**
 * Consultas do snapshot do workspace.
 *
 * Todo caminho sai de `src/lib/firebase/paths.ts` — nenhuma string e montada
 * aqui. E o que impede o vazamento entre organizacoes por descuido.
 */

/**
 * Teto de documentos por colecao.
 *
 * O contrato do repositorio entrega o tenant inteiro, e para um consultorio
 * isso e barato. Os limites existem para que uma organizacao antiga nao
 * transforme a primeira carga em uma conta inesperada: as colecoes que crescem
 * sem parar (mensagens, decisoes, auditoria) vem das mais recentes para as mais
 * antigas. Paginar por colecao e a evolucao natural — e nao muda a interface.
 */
export const SNAPSHOT_LIMITS = {
  professionals: 50,
  clients: 500,
  appointments: 500,
  conversations: 200,
  messages: 500,
  transactions: 500,
  aiRules: 200,
  aiDecisions: 200,
  notifications: 100,
  auditLogs: 200,
} as const;

export function organizationRef(
  db: Firestore,
  organizationId: ID,
): DocumentReference {
  return doc(db, paths.organization(organizationId));
}

function tenantQuery(
  db: Firestore,
  organizationId: ID,
  name: TenantCollection,
): Query {
  return collection(db, paths.collection(organizationId, name));
}

export const snapshotQueries = {
  professionals: (db: Firestore, organizationId: ID) =>
    query(
      tenantQuery(db, organizationId, "professionals"),
      orderBy("displayName"),
      limit(SNAPSHOT_LIMITS.professionals),
    ),

  clients: (db: Firestore, organizationId: ID) =>
    query(
      tenantQuery(db, organizationId, "clients"),
      orderBy("fullName"),
      limit(SNAPSHOT_LIMITS.clients),
    ),

  appointments: (db: Firestore, organizationId: ID) =>
    query(
      tenantQuery(db, organizationId, "appointments"),
      orderBy("startsAt", "desc"),
      limit(SNAPSHOT_LIMITS.appointments),
    ),

  conversations: (db: Firestore, organizationId: ID) =>
    query(
      tenantQuery(db, organizationId, "conversations"),
      orderBy("lastMessageAt", "desc"),
      limit(SNAPSHOT_LIMITS.conversations),
    ),

  /**
   * Mensagens sao subcolecao de cada conversa; um listener por conversa nao
   * escala. A `collectionGroup` com filtro de tenant resolve em uma consulta —
   * e o filtro nao e conveniencia: as Security Rules so aprovam a consulta
   * porque ele garante que todo documento retornado pertence a organizacao.
   */
  messages: (db: Firestore, organizationId: ID) =>
    query(
      collectionGroup(db, "messages"),
      where("organizationId", "==", organizationId),
      orderBy("sentAt", "desc"),
      limit(SNAPSHOT_LIMITS.messages),
    ),

  transactions: (db: Firestore, organizationId: ID) =>
    query(
      tenantQuery(db, organizationId, "transactions"),
      orderBy("dueDate", "desc"),
      limit(SNAPSHOT_LIMITS.transactions),
    ),

  aiRules: (db: Firestore, organizationId: ID) =>
    query(
      tenantQuery(db, organizationId, "aiRules"),
      orderBy("priority", "desc"),
      limit(SNAPSHOT_LIMITS.aiRules),
    ),

  aiDecisions: (db: Firestore, organizationId: ID) =>
    query(
      tenantQuery(db, organizationId, "aiDecisions"),
      orderBy("decidedAt", "desc"),
      limit(SNAPSHOT_LIMITS.aiDecisions),
    ),

  notifications: (db: Firestore, organizationId: ID) =>
    query(
      tenantQuery(db, organizationId, "notifications"),
      orderBy("createdAt", "desc"),
      limit(SNAPSHOT_LIMITS.notifications),
    ),

  auditLogs: (db: Firestore, organizationId: ID) =>
    query(
      tenantQuery(db, organizationId, "auditLogs"),
      orderBy("occurredAt", "desc"),
      limit(SNAPSHOT_LIMITS.auditLogs),
    ),
} as const;

/** Id gerado pelo Firestore, sem ida ao servidor. */
export function generateId(
  db: Firestore,
  organizationId: ID,
  name: TenantCollection,
): ID {
  return doc(collection(db, paths.collection(organizationId, name))).id;
}

export function generateMessageId(
  db: Firestore,
  organizationId: ID,
  conversationId: ID,
): ID {
  return doc(collection(db, messagesPath(organizationId, conversationId))).id;
}
