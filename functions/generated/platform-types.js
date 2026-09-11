// Gerado por scripts/build-functions.mjs.
/**
 * Atos da OPERADORA da plataforma — nunca de um tenant.
 *
 * Transpilado para `functions/generated/platform-types.js`: backend e navegador
 * precisam concordar sobre os mesmos tipos de concessao e de registro.
 */
/**
 * Por que a operadora abriu acesso sem passar pelo gateway. Nao existe
 * "outro": concessao sem categoria e exatamente o ajuste solto que o registro
 * existe para impedir.
 */
export const ACCESS_GRANT_KINDS = ["COURTESY", "PILOT", "CORRECTION"];
export const PLATFORM_AUDIT_ACTIONS = [
    "ACCOUNT_REGISTERED",
    "ACCOUNT_UPDATED",
    "ACCESS_GRANTED",
    "ACCESS_REVOKED",
    // Unico ato desta trilha que nao e da operadora: o titular encerra a propria
    // organizacao. Fica aqui porque o tenant deixa de existir para guardar o
    // registro, e porque encerrar organizacao e assunto do contrato com a
    // plataforma.
    "ORGANIZATION_DELETED",
];
/**
 * O que a operadora pode fazer. Nao ha permissao de tenant aqui: ler cliente,
 * agenda ou financeiro de uma organizacao nao e ato de plataforma.
 */
export const PLATFORM_PERMISSIONS = [
    "account:list",
    "account:register",
    "account:update",
    "accessGrant:read",
    "accessGrant:create",
    "accessGrant:revoke",
    "platformBilling:read",
    "platformAudit:read",
];
