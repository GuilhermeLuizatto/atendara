import type { ID } from "@/types";

/**
 * Caminhos do Firestore.
 *
 * TODA colecao de dados de negocio vive sob `organizations/{organizationId}`.
 * Este arquivo e a unica fonte desses caminhos: nenhum servico monta string de
 * path a mao, o que torna impossivel esquecer o prefixo do tenant e vazar dados
 * entre organizacoes por descuido.
 *
 * `userMemberships` e a unica colecao de nivel raiz alem de `organizations`.
 * Ela responde "de quais organizacoes este usuario participa?" sem exigir uma
 * `collectionGroup` query — que as Security Rules teriam dificuldade de
 * restringir com seguranca.
 */

export const ROOT_COLLECTIONS = {
  organizations: "organizations",
  userMemberships: "userMemberships",
  accounts: "accounts",
  initialPasswords: "initialPasswords",
} as const;

export const TENANT_COLLECTIONS = {
  professionals: "professionals",
  members: "members",
  clients: "clients",
  appointments: "appointments",
  conversations: "conversations",
  messages: "messages",
  transactions: "transactions",
  aiRules: "aiRules",
  aiDecisions: "aiDecisions",
  notifications: "notifications",
  auditLogs: "auditLogs",
} as const;

export type TenantCollection = keyof typeof TENANT_COLLECTIONS;

export const paths = {
  accounts: () => ROOT_COLLECTIONS.accounts,
  account: (userId: ID) => `${ROOT_COLLECTIONS.accounts}/${userId}`,
  initialPassword: (userId: ID) => `${ROOT_COLLECTIONS.initialPasswords}/${userId}`,
  organizations: () => ROOT_COLLECTIONS.organizations,
  organization: (organizationId: ID) =>
    `${ROOT_COLLECTIONS.organizations}/${organizationId}`,

  /** `userMemberships/{userId}` -> documento com o mapa de organizacoes. */
  userMembership: (userId: ID) =>
    `${ROOT_COLLECTIONS.userMemberships}/${userId}`,

  collection: (organizationId: ID, collection: TenantCollection) =>
    `${ROOT_COLLECTIONS.organizations}/${organizationId}/${TENANT_COLLECTIONS[collection]}`,

  document: (organizationId: ID, collection: TenantCollection, id: ID) =>
    `${ROOT_COLLECTIONS.organizations}/${organizationId}/${TENANT_COLLECTIONS[collection]}/${id}`,
} as const;

/**
 * Mensagens ficam em subcolecao da conversa: o volume cresce muito mais rapido
 * que o das demais colecoes e a leitura e quase sempre por conversa. Isso
 * mantem as queries baratas e os indices simples.
 */
export function messagesPath(organizationId: ID, conversationId: ID): string {
  return `${paths.document(organizationId, "conversations", conversationId)}/${TENANT_COLLECTIONS.messages}`;
}

export function messagePath(
  organizationId: ID,
  conversationId: ID,
  messageId: ID,
): string {
  return `${messagesPath(organizationId, conversationId)}/${messageId}`;
}
