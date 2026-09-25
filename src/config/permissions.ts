import {
  PERMISSIONS,
  PLATFORM_PERMISSIONS,
  type Permission,
  type PlatformPermission,
  type Role,
} from "@/types";
import type { AccountAccess } from "@/types/access";

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
  // Quem ve a agenda precisa ver o catalogo: e ele que diz o que cada
  // atendimento e, quanto dura e quanto custa.
  "service:read",
  "member:read",
  "client:read",
  "appointment:read",
  "conversation:read",
  "transaction:read",
  "rule:read",
  "aiDecision:read",
  "notification:read",
  "receipt:read",
  "support:create",
  "support:read",
  "support:reply",
];

const ASSISTANT_PERMISSIONS: Permission[] = [
  ...READ_ONLY_PERMISSIONS,
  "client:create",
  "client:update",
  // Quem atende o cadastro registra o que a pessoa autorizou ou retirou. Nas
  // rules, e o `canWriteOperational()` da regra de `clients`, com
  // `consentWriteOk()` conferindo o historico.
  "notificationConsent:record",
  "appointment:create",
  "appointment:update",
  "appointment:cancel",
  "conversation:reply",
  "transaction:create",
  "notification:acknowledge",
];

const PROFESSIONAL_PERMISSIONS: Permission[] = [
  ...ASSISTANT_PERMISSIONS,
  // Quem atende define o proprio preco e a propria duracao (decisao de 13/09).
  "service:manage",
  "automationQueue:read",
  "client:delete",
  "transaction:update",
  "rule:create",
  "rule:update",
  "rule:delete",
  "member:request",
  "import:manage",
  // Quem assina o recibo: OWNER, ADMIN e o profissional (decisao de 25/09).
  // A secretaria le, mas nao emite nem cancela.
  "receipt:create",
  "receipt:cancel",
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...PROFESSIONAL_PERMISSIONS,
  // Reenviar faz mensagem sair de novo: fica com quem administra.
  "automationTask:retry",
  // A chave de emergencia tambem: parada de emergencia nao pode depender de
  // uma unica pessoa estar alcancavel. O titular a tem pela lista de titular.
  "automationSwitch:manage",
  "transaction:delete",
  "organization:update",
  // Os mesmos papeis que mudam as autorizacoes da Dara julgam se ela acertou
  // (decisao do titular, 25/09). Espelha `isAdmin()` em `aiDecisionReviews`.
  "aiDecision:review",
  "notificationSettings:update",
  "agendaSettings:update",
  "member:invite",
  "member:update",
  "member:remove",
  "organizationBranding:update",
  "receiptSettings:update",
  "auditLog:read",
  // Espelha `PRIVACY_RESPONSIBLE_ROLES` (`src/config/privacy.ts`) e
  // `privacyResponsible()` nas rules. O titular da organizacao tambem atende,
  // pela lista `ORGANIZATION_HOLDER_PERMISSIONS` abaixo.
  "privacy:export",
  "privacy:erase",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  PROFESSIONAL: PROFESSIONAL_PERMISSIONS,
  ASSISTANT: ASSISTANT_PERMISSIONS,
  VIEWER: READ_ONLY_PERMISSIONS,
};

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  PROFESSIONAL: "Profissional",
  ASSISTANT: "Secretária",
  VIEWER: "Visualizador",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Controle total, incluindo faturamento e exclusão da organização.",
  ADMIN: "Gerencia equipe, configurações e todos os dados operacionais.",
  PROFESSIONAL: "Atende, gerencia a própria agenda e as regras do agente.",
  ASSISTANT: "Apoia a operação: agenda, cadastros e mensagens.",
  VIEWER: "Consulta os dados permitidos e participa dos próprios chamados de suporte.",
};

/**
 * O que o titular da organizacao (`ownerId`) recebe alem do proprio papel.
 *
 * O autonomo nasce `PROFESSIONAL` e dono da organizacao: sem esta lista ele nao
 * configuraria os avisos que a propria organizacao envia. A lista e fechada de
 * proposito — ser titular nao e ser ADMIN, e nenhum outro membro ganha nada por
 * ela. Espelha `organizationHolder()` nas rules, que so abre para o titular a
 * troca de `settings.notifications` e `settings.agenda` e a leitura de
 * `privacyRequests`.
 */
export const ORGANIZATION_HOLDER_PERMISSIONS: readonly Permission[] = [
  "notificationSettings:update",
  "agendaSettings:update",
  // A chave de emergencia e do titular, mesmo sem papel administrativo: quem
  // responde pela organizacao precisa conseguir calar a saida na hora.
  "automationSwitch:manage",
  "privacy:export",
  "privacy:erase",
  "organizationBranding:update",
  "member:invite",
  "member:update",
  "member:remove",
  // O autonomo e o emissor do proprio recibo.
  "receiptSettings:update",
];

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Permissoes de um vinculo: as do papel, somadas as de titular quando for o caso. */
export function permissionsForMembership(
  role: Role,
  isOrganizationHolder: boolean,
): Permission[] {
  const own = ROLE_PERMISSIONS[role];
  if (!isOrganizationHolder) return own;
  return [
    ...own,
    ...ORGANIZATION_HOLDER_PERMISSIONS.filter((permission) => !own.includes(permission)),
  ];
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

/**
 * Matriz da OPERADORA, separada da matriz de papeis de proposito: papel de
 * plataforma nao e papel dentro de uma organizacao, e nao herda nenhuma
 * permissao de tenant. Espelha `platformAdmin()` nas rules, que so
 * aparece em `accounts` e nas colecoes `platform*`, e `adminOf()` nas callables.
 *
 * Nas duas pontas a permissao so vale com segundo fator na sessao; aqui fica o
 * "o que", la fica o "com qual prova".
 */
/**
 * Atos so da chave mestra (`platformMaster`). Ficam fora do papel de proposito:
 * um administrador comprometido nao cria outros administradores. Espelha
 * `masterOf()` nas callables; as rules nao precisam, porque contas so nascem e
 * mudam pelo backend.
 */
export const PLATFORM_MASTER_PERMISSIONS: readonly PlatformPermission[] = ["platformAdmin:manage"];

export const PLATFORM_ROLE_PERMISSIONS: Record<
  AccountAccess["platformRole"],
  PlatformPermission[]
> = {
  PLATFORM_ADMIN: PLATFORM_PERMISSIONS.filter((permission) => !PLATFORM_MASTER_PERMISSIONS.includes(permission)),
  PROFESSIONAL: [],
};

export function hasPlatformPermission(
  account: AccountAccess | null | undefined,
  permission: PlatformPermission,
): boolean {
  if (!account || account.status !== "ACTIVE" || account.mustChangePassword) return false;
  if (PLATFORM_MASTER_PERMISSIONS.includes(permission)) {
    return account.platformRole === "PLATFORM_ADMIN" && account.platformMaster === true;
  }
  return PLATFORM_ROLE_PERMISSIONS[account.platformRole].includes(permission);
}
