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
export const MANUAL_ACCESS_GRANT_KINDS = [
    "COURTESY",
    "PILOT",
    "CORRECTION",
];
/**
 * `TRIAL` fica fora das manuais de proposito: o teste de 14 dias nasce so da
 * callable de autocadastro, com prazo e motivo fixos. A operadora nao escolhe
 * esse tipo na tela nem pela callable de concessao — se pudesse, "teste" viraria
 * o rotulo comodo de qualquer cortesia, e o relatorio de quem esta testando
 * deixaria de significar alguma coisa.
 */
export const ACCESS_GRANT_KINDS = [
    ...MANUAL_ACCESS_GRANT_KINDS,
    "TRIAL",
];
export const PLATFORM_AUDIT_ACTIONS = [
    "ACCOUNT_REGISTERED",
    "ACCOUNT_UPDATED",
    "ACCESS_GRANTED",
    "ACCESS_REVOKED",
    // Autocadastro: a pessoa se cadastra sozinha e o teste comeca quando ela
    // confirma o e-mail. Sao dois atos distintos porque acontecem em momentos
    // diferentes, e o segundo e o que abre o painel.
    "SELF_SERVICE_REGISTERED",
    "TRIAL_STARTED",
    // O fim do teste, aplicado pela rotina diaria. Nao e ato de ninguem: e a
    // validade que a concessao ja trazia, chegando.
    "TRIAL_ENDED",
    // Atos da chave mestra sobre contas de administrador.
    "PLATFORM_ADMIN_CREATED",
    "PLATFORM_ADMIN_SUSPENDED",
    "PLATFORM_ADMIN_REACTIVATED",
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
    // So da chave mestra: criar, suspender e reativar administradores.
    "platformAdmin:manage",
];
