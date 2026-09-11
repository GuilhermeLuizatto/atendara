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
 * Tamanho da pagina por colecao.
 *
 * A primeira carga traz uma pagina de cada; `loadMore` soma mais uma. As
 * colecoes que crescem sem parar (agenda, financeiro, mensagens, decisoes,
 * auditoria) vem das mais recentes para as mais antigas, entao o que fica de
 * fora da primeira pagina e sempre o historico mais distante.
 */
export const SNAPSHOT_PAGE_SIZES = {
  professionals: 50,
  clients: 500,
  appointments: 500,
  conversations: 200,
  messages: 500,
  transactions: 500,
  aiRules: 200,
  aiDecisions: 200,
  notifications: 100,
  notificationDeliveries: 200,
  auditLogs: 200,
} as const;

export type PagedPart = keyof typeof SNAPSHOT_PAGE_SIZES;

export function organizationRef(
  db: Firestore,
  organizationId: ID,
): DocumentReference {
  return doc(db, paths.organization(organizationId));
}

/** O vinculo de um usuario. As rules deixam cada membro ler os da propria organizacao. */
export function membershipRef(
  db: Firestore,
  organizationId: ID,
  userId: ID,
): DocumentReference {
  return doc(db, paths.document(organizationId, "members", userId));
}

function tenantQuery(
  db: Firestore,
  organizationId: ID,
  name: TenantCollection,
): Query {
  return collection(db, paths.collection(organizationId, name));
}

/**
 * `count` e o total pedido naquele momento. Quem chama pede um documento a
 * mais do que mostra, para saber se existe proxima pagina.
 */
export const snapshotQueries: Record<
  PagedPart,
  (db: Firestore, organizationId: ID, count: number) => Query
> = {
  professionals: (db, organizationId, count) =>
    query(
      tenantQuery(db, organizationId, "professionals"),
      orderBy("displayName"),
      limit(count),
    ),

  clients: (db, organizationId, count) =>
    query(
      tenantQuery(db, organizationId, "clients"),
      orderBy("fullName"),
      limit(count),
    ),

  appointments: (db, organizationId, count) =>
    query(
      tenantQuery(db, organizationId, "appointments"),
      orderBy("startsAt", "desc"),
      limit(count),
    ),

  conversations: (db, organizationId, count) =>
    query(
      tenantQuery(db, organizationId, "conversations"),
      orderBy("lastMessageAt", "desc"),
      limit(count),
    ),

  /**
   * Mensagens sao subcolecao de cada conversa; um listener por conversa nao
   * escala. A `collectionGroup` com filtro de tenant resolve em uma consulta —
   * e o filtro nao e conveniencia: as Security Rules so aprovam a consulta
   * porque ele garante que todo documento retornado pertence a organizacao.
   */
  messages: (db, organizationId, count) =>
    query(
      collectionGroup(db, "messages"),
      where("organizationId", "==", organizationId),
      orderBy("sentAt", "desc"),
      limit(count),
    ),

  transactions: (db, organizationId, count) =>
    query(
      tenantQuery(db, organizationId, "transactions"),
      orderBy("dueDate", "desc"),
      limit(count),
    ),

  aiRules: (db, organizationId, count) =>
    query(
      tenantQuery(db, organizationId, "aiRules"),
      orderBy("priority", "desc"),
      limit(count),
    ),

  aiDecisions: (db, organizationId, count) =>
    query(
      tenantQuery(db, organizationId, "aiDecisions"),
      orderBy("decidedAt", "desc"),
      limit(count),
    ),

  notifications: (db, organizationId, count) =>
    query(
      tenantQuery(db, organizationId, "notifications"),
      orderBy("createdAt", "desc"),
      limit(count),
    ),

  notificationDeliveries: (db, organizationId, count) =>
    query(
      tenantQuery(db, organizationId, "notificationDeliveries"),
      orderBy("scheduledFor", "desc"),
      limit(count),
    ),

  auditLogs: (db, organizationId, count) =>
    query(
      tenantQuery(db, organizationId, "auditLogs"),
      orderBy("occurredAt", "desc"),
      limit(count),
    ),
};

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
