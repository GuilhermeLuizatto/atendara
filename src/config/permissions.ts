import { PERMISSIONS, type Permission, type Role } from "@/types";

/**
 * Matriz RBAC. Esta e a unica definicao de "quem pode o que" no produto.
 *
 * As Firestore Security Rules (`firestore.rules`) reimplementam esta matriz em
 * CEL — nao ha como compartilhar codigo entre TypeScript e as rules, entao os
 * dois arquivos precisam ser alterados juntos. O teste
 * `src/config/permissions.test.ts` documenta os invariantes que ambos devem
 * respeitar.
 */

const ALL_PERMISSIONS = [...PERMISSIONS] as Permission[];

const READ_ONLY_PERMISSIONS: Permission[] = [
  "organization:read",
  "member:read",
  "client:read",
  "appointment:read",
  "conversation:read",
  "transaction:read",
  "rule:read",
  "aiDecision:read",
  "notification:read",
];

const ASSISTANT_PERMISSIONS: Permission[] = [
  ...READ_ONLY_PERMISSIONS,
  "client:create",
  "client:update",
  "appointment:create",
  "appointment:update",
  "appointment:cancel",
  "conversation:reply",
  "transaction:create",
  "notification:acknowledge",
];

const PROFESSIONAL_PERMISSIONS: Permission[] = [
  ...ASSISTANT_PERMISSIONS,
  "client:delete",
  "transaction:update",
  "rule:create",
  "rule:update",
  "rule:delete",
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...PROFESSIONAL_PERMISSIONS,
  "transaction:delete",
  "organization:update",
  "member:invite",
  "member:update",
  "member:remove",
  "auditLog:read",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  PROFESSIONAL: PROFESSIONAL_PERMISSIONS,
  ASSISTANT: ASSISTANT_PERMISSIONS,
  VIEWER: READ_ONLY_PERMISSIONS,
};

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Proprietario",
  ADMIN: "Administrador",
  PROFESSIONAL: "Profissional",
  ASSISTANT: "Secretaria",
  VIEWER: "Visualizador",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Controle total, incluindo faturamento e exclusao da organizacao.",
  ADMIN: "Gerencia equipe, configuracoes e todos os dados operacionais.",
  PROFESSIONAL: "Atende, gerencia a propria agenda e as regras do agente.",
  ASSISTANT: "Apoia a operacao: agenda, cadastros e mensagens.",
  VIEWER: "Apenas leitura. Nao altera nenhum dado.",
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyPermission(
  role: Role,
  permissions: Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}
