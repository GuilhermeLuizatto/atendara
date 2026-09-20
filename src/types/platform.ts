import type { ID, ISODateString } from "./common";

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
] as const;

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
] as const;
export type AccessGrantKind = (typeof ACCESS_GRANT_KINDS)[number];
export type ManualAccessGrantKind = (typeof MANUAL_ACCESS_GRANT_KINDS)[number];

/**
 * Concessao manual de acesso, uma por organizacao
 * (`platformAccessGrants/{organizationId}`). Guarda so a vigente: o historico
 * de concessoes e revogacoes vive em `platformAuditLogs`, append-only.
 */
export interface PlatformAccessGrant {
  organizationId: ID;
  /** Titular da organizacao, cuja conta recebe o portao de acesso. */
  subscriberUserId: ID;
  kind: AccessGrantKind;
  reason: string;
  until: ISODateString;
  grantedBy: ID;
  grantedAt: ISODateString;
  revokedAt: ISODateString | null;
  revokedBy: ID | null;
  revokeReason: string | null;
}

export interface InitialAccessGrant {
  kind: ManualAccessGrantKind;
  until: ISODateString;
  reason: string;
}

export interface AccessGrantInput extends InitialAccessGrant {
  organizationId: ID;
}

export const PLATFORM_AUDIT_ACTIONS = [
  "ACCOUNT_REGISTERED",
  "ACCOUNT_UPDATED",
  "ACCESS_GRANTED",
  // Remetente de canal real cadastrado pela operadora (13.4): e ela quem
  // carimba que aquele numero pode falar em nome daquela clinica.
  "MESSAGING_SENDER_REGISTERED",
  "ACCESS_REVOKED",
  // Autocadastro: a pessoa se cadastra sozinha e o teste comeca quando ela
  // confirma o e-mail. Sao dois atos distintos porque acontecem em momentos
  // diferentes, e o segundo e o que abre o painel.
  "SELF_SERVICE_REGISTERED",
  "TRIAL_STARTED",
  // O fim do teste, aplicado pela rotina diaria. Nao e ato de ninguem: e a
  // validade que a concessao ja trazia, chegando.
  "TRIAL_ENDED",
  // Trinta dias depois do bloqueio, sem assinatura e sem pedido: a organizacao
  // abandonada deixa de identificar alguem. E o mesmo apagamento que o titular
  // pede, sem o titular.
  "ABANDONED_ORGANIZATION_ERASED",
  // Sete dias sem confirmar o e-mail: o cadastro por senha sai inteiro, pelo
  // mesmo apagamento da exclusao de organizacao (A.8).
  "UNCONFIRMED_SIGNUP_ERASED",
  // Sete dias com login e sem conta no Atendara: a entrada pelo Google que parou
  // antes da segunda tela. So o login existe, e so ele sai (A.8).
  "ORPHAN_LOGIN_REMOVED",
  // Troca de profissao: quem pede e o titular, quem decide e a operadora. Sao
  // tres atos porque sao tres momentos, e a recusa tambem precisa ficar escrita.
  "PROFESSION_CHANGE_REQUESTED",
  "PROFESSION_CHANGE_APPROVED",
  "PROFESSION_CHANGE_REJECTED",
  // Atos da chave mestra sobre contas de administrador.
  "PLATFORM_ADMIN_CREATED",
  "PLATFORM_ADMIN_SUSPENDED",
  "PLATFORM_ADMIN_REACTIVATED",
  // Unico ato desta trilha que nao e da operadora: o titular encerra a propria
  // organizacao. Fica aqui porque o tenant deixa de existir para guardar o
  // registro, e porque encerrar organizacao e assunto do contrato com a
  // plataforma.
  "ORGANIZATION_DELETED",
] as const;
export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

/**
 * Trilha dos atos da operadora. Gravada pelo backend na MESMA transacao do ato;
 * nenhum cliente escreve, nem a propria operadora. Ids, nunca e-mail ou nome:
 * quem le cruza com `accounts`.
 */
export interface PlatformAuditLog {
  id: ID;
  action: PlatformAuditAction;
  actorId: ID;
  organizationId: ID | null;
  targetUserId: ID | null;
  reason: string | null;
  details: Record<string, unknown>;
  createdAt: ISODateString;
}

/**
 * O que a operadora pode fazer. Nao ha permissao de tenant aqui: ler cliente,
 * agenda ou financeiro de uma organizacao nao e ato de plataforma.
 */
/** Situacao de um pedido de troca de profissao. */
export const PROFESSION_CHANGE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ProfessionChangeStatus = (typeof PROFESSION_CHANGE_STATUSES)[number];

/**
 * Pedido de troca de profissao, um por organizacao
 * (`platformProfessionRequests/{organizationId}`).
 *
 * A profissao decide vocabulario, taxonomia, canais e travas de aviso. Trocar
 * sozinho permitiria a um dentista virar medico, ou a um psiquiatra virar
 * psicologo, sem ninguem olhar — por isso o pedido existe e por isso a decisao
 * e da operadora, com segundo fator e registro. Enquanto nao houver aprovacao,
 * a profissao nao muda.
 */
export interface ProfessionChangeRequest {
  organizationId: ID;
  /** Titular que pediu. A callable confere contra o `ownerId` no servidor. */
  requestedBy: ID;
  from: import("./profession").ProfessionId;
  to: import("./profession").ProfessionId;
  reason: string;
  status: ProfessionChangeStatus;
  requestedAt: ISODateString;
  decidedAt: ISODateString | null;
  decidedBy: ID | null;
  decisionReason: string | null;
}

export const PLATFORM_PERMISSIONS = [
  "account:list",
  "account:register",
  "account:update",
  "accessGrant:read",
  "accessGrant:create",
  "accessGrant:revoke",
  "professionChange:read",
  "professionChange:decide",
  "platformBilling:read",
  "platformAudit:read",
  // So da chave mestra: criar, suspender e reativar administradores.
  "platformAdmin:manage",
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
