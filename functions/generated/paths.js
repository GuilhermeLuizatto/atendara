// Gerado por scripts/build-functions.mjs.
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
};
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
};
export const paths = {
    accounts: () => ROOT_COLLECTIONS.accounts,
    account: (userId) => `${ROOT_COLLECTIONS.accounts}/${userId}`,
    initialPassword: (userId) => `${ROOT_COLLECTIONS.initialPasswords}/${userId}`,
    organizations: () => ROOT_COLLECTIONS.organizations,
    organization: (organizationId) => `${ROOT_COLLECTIONS.organizations}/${organizationId}`,
    /** `userMemberships/{userId}` -> documento com o mapa de organizacoes. */
    userMembership: (userId) => `${ROOT_COLLECTIONS.userMemberships}/${userId}`,
    collection: (organizationId, collection) => `${ROOT_COLLECTIONS.organizations}/${organizationId}/${TENANT_COLLECTIONS[collection]}`,
    document: (organizationId, collection, id) => `${ROOT_COLLECTIONS.organizations}/${organizationId}/${TENANT_COLLECTIONS[collection]}/${id}`,
};
/**
 * Mensagens ficam em subcolecao da conversa: o volume cresce muito mais rapido
 * que o das demais colecoes e a leitura e quase sempre por conversa. Isso
 * mantem as queries baratas e os indices simples.
 */
export function messagesPath(organizationId, conversationId) {
    return `${paths.document(organizationId, "conversations", conversationId)}/${TENANT_COLLECTIONS.messages}`;
}
export function messagePath(organizationId, conversationId, messageId) {
    return `${messagesPath(organizationId, conversationId)}/${messageId}`;
}
