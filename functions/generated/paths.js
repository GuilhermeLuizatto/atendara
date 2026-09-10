// Gerado por scripts/build-functions.mjs.
/**
 * Caminhos do Firestore.
 *
 * TODA colecao de dados de negocio vive sob `organizations/{organizationId}`.
 * Este arquivo e a unica fonte desses caminhos: nenhum servico monta string de
 * path a mao, o que torna impossivel esquecer o prefixo do tenant e vazar dados
 * entre organizacoes por descuido.
 *
 * `userMemberships` responde "de quais organizacoes este usuario participa?"
 * sem exigir uma `collectionGroup` query — que as Security Rules teriam
 * dificuldade de restringir com seguranca.
 *
 * As colecoes `platform*` sao a excecao deliberada a primeira frase: elas NAO
 * pertencem a tenant nenhum. Sao a cobranca que a operadora faz das clinicas e
 * profissionais assinantes, e por isso vivem na raiz, fora de `organizations/`.
 * Mensalidade da plataforma nunca vira `transactions` de um assinante (ADR
 * 0001, secao 2). Somente o backend escreve nelas.
 */
export const ROOT_COLLECTIONS = {
    organizations: "organizations",
    userMemberships: "userMemberships",
    accounts: "accounts",
    initialPasswords: "initialPasswords",
};
/** Cobranca da plataforma. Fora de `organizations/` por natureza. */
export const PLATFORM_COLLECTIONS = {
    platformPlans: "platformPlans",
    platformSubscriptions: "platformSubscriptions",
    platformInvoices: "platformInvoices",
    platformGatewayEvents: "platformGatewayEvents",
    platformCustomers: "platformCustomers",
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
    // Avisos que a organizacao envia a quem ela atende. Separada de
    // `notifications` de proposito: aquela e o alerta dentro do painel, esta e a
    // fila de saida, com estado de entrega e tentativas.
    notificationDeliveries: "notificationDeliveries",
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
    // ------------------------------------------------ cobranca da plataforma
    platformPlans: () => PLATFORM_COLLECTIONS.platformPlans,
    platformPlan: (planId) => `${PLATFORM_COLLECTIONS.platformPlans}/${planId}`,
    platformSubscriptions: () => PLATFORM_COLLECTIONS.platformSubscriptions,
    /**
     * O id do documento E o `organizationId`. Nao e economia de campo: e o que
     * torna impossivel uma organizacao acumular duas assinaturas ativas.
     */
    platformSubscription: (organizationId) => `${PLATFORM_COLLECTIONS.platformSubscriptions}/${organizationId}`,
    platformInvoices: () => PLATFORM_COLLECTIONS.platformInvoices,
    platformInvoice: (invoiceId) => `${PLATFORM_COLLECTIONS.platformInvoices}/${invoiceId}`,
    platformGatewayEvents: () => PLATFORM_COLLECTIONS.platformGatewayEvents,
    /**
     * Chaveado pelo id do evento do gateway. E o documento que, criado na mesma
     * transacao do efeito, transforma "webhook repetido" em no-op.
     */
    platformGatewayEvent: (eventId) => `${PLATFORM_COLLECTIONS.platformGatewayEvents}/${eventId}`,
    /**
     * `customerId` do gateway -> organizacao. Eventos de assinatura e de fatura
     * so carregam o cliente do gateway; sem este indice, resolver a organizacao
     * exigiria varredura — ou, pior, confiar em algo que o cliente enviou.
     */
    platformCustomer: (customerId) => `${PLATFORM_COLLECTIONS.platformCustomers}/${customerId}`,
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
