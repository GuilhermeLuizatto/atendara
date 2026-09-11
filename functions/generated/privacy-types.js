// Gerado por scripts/build-functions.mjs.
/**
 * Direitos do titular dos dados — o lado tecnico.
 *
 * Quem atende o pedido de um cliente (paciente, aluno) e a ORGANIZACAO que o
 * atende: e ela quem responde pelo cadastro. O backend executa e deixa
 * registro. Nada aqui afirma conformidade com norma nenhuma; o que o codigo
 * faz com cada colecao esta em `src/config/privacy.ts`, e prazos e excecoes a
 * eliminacao sao decisao juridica ainda pendente.
 *
 * Transpilado para `functions/generated/privacy-types.js`.
 */
export const PRIVACY_REQUEST_TYPES = [
    "CLIENT_EXPORT",
    "CLIENT_ERASURE",
    "ORGANIZATION_EXPORT",
];
/**
 * Por onde o pedido chegou. Lista fechada de proposito: um campo de texto livre
 * seria preenchido com nome e contato de quem pediu, e a trilha do pedido de
 * eliminacao passaria a guardar exatamente o que foi eliminado.
 */
export const PRIVACY_REQUEST_CHANNELS = [
    "IN_PERSON",
    "EMAIL",
    "PHONE",
    "MESSAGE",
    "LETTER",
    "OTHER",
];
/**
 * Secoes da exportacao da organizacao. Uma por colecao do tenant — o teste de
 * `src/config/privacy.test.ts` confere contra `TENANT_COLLECTIONS`, para que
 * uma colecao nova nao fique fora da exportacao em silencio.
 */
export const ORGANIZATION_EXPORT_SECTIONS = [
    "members",
    "professionals",
    "clients",
    "appointments",
    "conversations",
    "messages",
    "transactions",
    "aiRules",
    "aiDecisions",
    "notifications",
    "notificationDeliveries",
    "auditLogs",
    "privacyRequests",
];
