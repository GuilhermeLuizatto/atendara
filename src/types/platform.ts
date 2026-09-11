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
export const ACCESS_GRANT_KINDS = ["COURTESY", "PILOT", "CORRECTION"] as const;
export type AccessGrantKind = (typeof ACCESS_GRANT_KINDS)[number];

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
  kind: AccessGrantKind;
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
  "ACCESS_REVOKED",
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
export const PLATFORM_PERMISSIONS = [
  "account:list",
  "account:register",
  "account:update",
  "accessGrant:read",
  "accessGrant:create",
  "accessGrant:revoke",
  "platformBilling:read",
  "platformAudit:read",
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
