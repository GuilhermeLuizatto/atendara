import type { ID, TenantScopedEntity } from "./common";
import type { ProfessionId } from "./profession";

export const ROLES = [
  "OWNER",
  "ADMIN",
  "PROFESSIONAL",
  "ASSISTANT",
  "VIEWER",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Permissoes sao granulares e independentes das telas. As Security Rules do
 * Firestore derivam do mesmo mapa (`src/config/permissions.ts`), de modo que a
 * interface e o banco concordam sobre quem pode o que.
 */
export const PERMISSIONS = [
  "organization:read",
  "organization:update",
  // Separada de `organization:update` porque o titular da organizacao a recebe
  // sem papel administrativo: configurar os avisos nao da acesso ao resto.
  "notificationSettings:update",
  "organization:delete",
  "billing:manage",
  "member:read",
  "member:invite",
  "member:update",
  "member:remove",
  "client:read",
  "client:create",
  "client:update",
  "client:delete",
  "appointment:read",
  "appointment:create",
  "appointment:update",
  "appointment:cancel",
  "conversation:read",
  "conversation:reply",
  "transaction:read",
  "transaction:create",
  "transaction:update",
  "transaction:delete",
  "rule:read",
  "rule:create",
  "rule:update",
  "rule:delete",
  "aiDecision:read",
  "notification:read",
  "notification:acknowledge",
  "auditLog:read",
  // Pedidos do titular dos dados: exportar e eliminar o que a organizacao
  // guarda sobre uma pessoa atendida. Executados so pelo backend.
  "privacy:export",
  "privacy:erase",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Vinculo de um usuario com uma organizacao. Um mesmo usuario Firebase pode ter
 * varios memberships (ex.: atende em duas clinicas).
 */
export interface Membership extends TenantScopedEntity {
  /** UID do Firebase Authentication. */
  userId: ID;
  role: Role;
  status: "ACTIVE" | "INVITED" | "SUSPENDED";
  invitedBy: ID | null;
}

/**
 * Perfil profissional dentro de uma organizacao. Separado de `Membership`
 * porque um ASSISTANT tem vinculo mas nao atende, e um profissional pode ter
 * agenda mesmo antes de aceitar o convite.
 */
export interface Professional extends TenantScopedEntity {
  userId: ID | null;
  displayName: string;
  email: string;
  phone: string | null;
  profession: ProfessionId;
  /** Registro do conselho de classe (CRP, CRM, CRO, CREF...). Opcional. */
  licenseNumber: string | null;
  specialties: string[];
  avatarUrl: string | null;
  active: boolean;
}

/** Sessao resolvida do usuario: quem ele e e no tenant em que esta operando. */
export interface AuthenticatedUser {
  userId: ID;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  access?: import("./access").AccountAccess | null;
}

export interface ActiveSession {
  user: AuthenticatedUser;
  organizationId: ID;
  role: Role;
  /** `ownerId` da organizacao. Soma as permissoes de titular ao papel. */
  isOrganizationHolder: boolean;
  permissions: Permission[];
  professionalId: ID | null;
}
