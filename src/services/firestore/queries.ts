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
  type QueryConstraint,
} from "firebase/firestore";

import type { ProfessionalScope } from "@/lib/access/professional-scope";
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
  // O catalogo e pequeno por natureza: o teto de 100 esta em SERVICE_LIMITS.
  services: 100,
  appointments: 500,
  conversations: 200,
  messages: 500,
  transactions: 500,
  recurringCharges: 300,
  paymentLinks: 300,
  paymentProofs: 300,
  receipts: 300,
  // Um documento so, de id `organization`.
  receiptSettings: 1,
  aiRules: 200,
  aiDecisions: 200,
  // Acompanha `aiDecisions`: o acerto so se calcula onde as duas paginas se cruzam.
  aiDecisionReviews: 200,
  notifications: 100,
  notificationDeliveries: 200,
  automationTasks: 100,
  // Um documento por profissional conectado; o teto acompanha `professionals`.
  calendarBusyBlocks: 50,
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
type SnapshotQueryFactory = (
  db: Firestore,
  organizationId: ID,
  count: number,
  scope: ProfessionalScope,
) => Query[];

const FIRESTORE_IN_LIMIT = 30;

function chunks(values: ID[]): ID[][] {
  const result: ID[][] = [];
  for (let index = 0; index < values.length; index += FIRESTORE_IN_LIMIT) {
    result.push(values.slice(index, index + FIRESTORE_IN_LIMIT));
  }
  return result;
}

function scopedTenantQueries(
  db: Firestore,
  organizationId: ID,
  name: TenantCollection,
  field: string,
  scope: ProfessionalScope,
  count: number,
  constraints: QueryConstraint[],
): Query[] {
  const source = tenantQuery(db, organizationId, name);
  if (scope.organizationWide) return [query(source, ...constraints, limit(count))];
  return chunks(scope.professionalIds).map((professionalIds) =>
    query(
      source,
      where(field, "in", professionalIds),
      ...constraints,
      limit(count),
    ),
  );
}

function unscopedTenantQuery(
  db: Firestore,
  organizationId: ID,
  name: TenantCollection,
  count: number,
  constraints: QueryConstraint[] = [],
): Query[] {
  return [query(tenantQuery(db, organizationId, name), ...constraints, limit(count))];
}

export const snapshotQueries: Record<PagedPart, SnapshotQueryFactory> = {
  professionals: (db, organizationId, count) =>
    unscopedTenantQuery(db, organizationId, "professionals", count, [
      orderBy("displayName"),
    ]),

  clients: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "clients", "assignedProfessionalId", scope, count, [
      orderBy("fullName"),
    ]),

  // A ordem da lista e a que ela escolheu (`position`).
  services: (db, organizationId, count) =>
    unscopedTenantQuery(db, organizationId, "services", count, [orderBy("position")]),

  appointments: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "appointments", "professionalId", scope, count, [
      orderBy("startsAt", "desc"),
    ]),

  conversations: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "conversations", "professionalId", scope, count, [
      orderBy("lastMessageAt", "desc"),
    ]),

  /**
   * Mensagens sao subcolecao de cada conversa; um listener por conversa nao
   * escala. A `collectionGroup` com filtro de tenant resolve em uma consulta —
   * e o filtro nao e conveniencia: as Security Rules so aprovam a consulta
   * porque ele garante que todo documento retornado pertence a organizacao.
   */
  messages: (db, organizationId, count, scope) => {
    const source = collectionGroup(db, "messages");
    if (scope.organizationWide) {
      return [
        query(
          source,
          where("organizationId", "==", organizationId),
          orderBy("sentAt", "desc"),
          limit(count),
        ),
      ];
    }
    return chunks(scope.professionalIds).map((professionalIds) =>
      query(
        source,
        where("organizationId", "==", organizationId),
        where("professionalId", "in", professionalIds),
        orderBy("sentAt", "desc"),
        limit(count),
      ),
    );
  },

  transactions: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "transactions", "professionalId", scope, count, [
      orderBy("dueDate", "desc"),
    ]),

  recurringCharges: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "recurringCharges", "professionalId", scope, count, [
      orderBy("createdAt", "desc"),
    ]),

  paymentLinks: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "paymentLinks", "professionalId", scope, count, [
      orderBy("createdAt", "desc"),
    ]),

  paymentProofs: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "paymentProofs", "professionalId", scope, count, [
      orderBy("submittedAt", "desc"),
    ]),

  receipts: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "receipts", "professionalId", scope, count, [
      orderBy("number", "desc"),
    ]),

  receiptSettings: (db, organizationId, count) =>
    unscopedTenantQuery(db, organizationId, "receiptSettings", count),

  aiRules: (db, organizationId, count, scope) => {
    if (scope.organizationWide) {
      return unscopedTenantQuery(db, organizationId, "aiRules", count, [
        orderBy("priority", "desc"),
      ]);
    }
    return [
      ...unscopedTenantQuery(db, organizationId, "aiRules", count, [
        where("professionalId", "==", null),
        orderBy("priority", "desc"),
      ]),
      ...scopedTenantQueries(db, organizationId, "aiRules", "professionalId", scope, count, [
        orderBy("priority", "desc"),
      ]),
    ];
  },

  aiDecisions: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "aiDecisions", "professionalId", scope, count, [
      orderBy("decidedAt", "desc"),
    ]),

  aiDecisionReviews: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "aiDecisionReviews", "professionalId", scope, count, [
      orderBy("updatedAt", "desc"),
    ]),

  notifications: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "notifications", "professionalId", scope, count, [
      orderBy("createdAt", "desc"),
    ]),

  notificationDeliveries: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "notificationDeliveries", "professionalId", scope, count, [
      orderBy("scheduledFor", "desc"),
    ]),

  auditLogs: (db, organizationId, count) =>
    unscopedTenantQuery(db, organizationId, "auditLogs", count, [orderBy("occurredAt", "desc")]),
  automationTasks: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "automationTasks", "professionalId", scope, count, [
      orderBy("createdAt", "desc"),
    ]),

  // Um documento por profissional; sem ordem de negócio, só um teto.
  calendarBusyBlocks: (db, organizationId, count, scope) =>
    scopedTenantQueries(db, organizationId, "calendarBusyBlocks", "professionalId", scope, count, []),
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
