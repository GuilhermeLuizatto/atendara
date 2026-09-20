// Gerado por scripts/build-functions.mjs.
import { PERMISSIONS, PLATFORM_PERMISSIONS, } from "./types.js";
/**
 * Matriz RBAC. Esta e a unica definicao de "quem pode o que" no produto.
 *
 * As Firestore Security Rules (`firestore.rules`) reimplementam esta matriz em
 * CEL — nao ha como compartilhar codigo entre TypeScript e as rules, entao os
 * dois arquivos precisam ser alterados juntos. O teste
 * `src/config/permissions.test.ts` documenta os invariantes que ambos devem
 * respeitar.
 */
const ALL_PERMISSIONS = [...PERMISSIONS];
const READ_ONLY_PERMISSIONS = [
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
const ASSISTANT_PERMISSIONS = [
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
const PROFESSIONAL_PERMISSIONS = [
    ...ASSISTANT_PERMISSIONS,
    "client:delete",
    "transaction:update",
    "rule:create",
    "rule:update",
    "rule:delete",
];
const ADMIN_PERMISSIONS = [
    ...PROFESSIONAL_PERMISSIONS,
    "transaction:delete",
    "organization:update",
    "notificationSettings:update",
    "agendaSettings:update",
    "member:invite",
    "member:update",
    "member:remove",
    "auditLog:read",
    // Espelha `PRIVACY_RESPONSIBLE_ROLES` (`src/config/privacy.ts`) e
    // `privacyResponsible()` nas rules. O titular da organizacao tambem atende,
    // pela lista `ORGANIZATION_HOLDER_PERMISSIONS` abaixo.
    "privacy:export",
    "privacy:erase",
];
export const ROLE_PERMISSIONS = {
    OWNER: ALL_PERMISSIONS,
    ADMIN: ADMIN_PERMISSIONS,
    PROFESSIONAL: PROFESSIONAL_PERMISSIONS,
    ASSISTANT: ASSISTANT_PERMISSIONS,
    VIEWER: READ_ONLY_PERMISSIONS,
};
export const ROLE_LABELS = {
    OWNER: "Proprietário",
    ADMIN: "Administrador",
    PROFESSIONAL: "Profissional",
    ASSISTANT: "Secretária",
    VIEWER: "Visualizador",
};
export const ROLE_DESCRIPTIONS = {
    OWNER: "Controle total, incluindo faturamento e exclusão da organização.",
    ADMIN: "Gerencia equipe, configurações e todos os dados operacionais.",
    PROFESSIONAL: "Atende, gerencia a própria agenda e as regras do agente.",
    ASSISTANT: "Apoia a operação: agenda, cadastros e mensagens.",
    VIEWER: "Apenas leitura. Não altera nenhum dado.",
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
export const ORGANIZATION_HOLDER_PERMISSIONS = [
    "notificationSettings:update",
    "agendaSettings:update",
    "privacy:export",
    "privacy:erase",
];
export function permissionsForRole(role) {
    return ROLE_PERMISSIONS[role];
}
/** Permissoes de um vinculo: as do papel, somadas as de titular quando for o caso. */
export function permissionsForMembership(role, isOrganizationHolder) {
    const own = ROLE_PERMISSIONS[role];
    if (!isOrganizationHolder)
        return own;
    return [
        ...own,
        ...ORGANIZATION_HOLDER_PERMISSIONS.filter((permission) => !own.includes(permission)),
    ];
}
export function hasPermission(role, permission) {
    return ROLE_PERMISSIONS[role].includes(permission);
}
export function hasAnyPermission(role, permissions) {
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
export const PLATFORM_MASTER_PERMISSIONS = ["platformAdmin:manage"];
export const PLATFORM_ROLE_PERMISSIONS = {
    PLATFORM_ADMIN: PLATFORM_PERMISSIONS.filter((permission) => !PLATFORM_MASTER_PERMISSIONS.includes(permission)),
    PROFESSIONAL: [],
};
export function hasPlatformPermission(account, permission) {
    if (!account || account.status !== "ACTIVE" || account.mustChangePassword)
        return false;
    if (PLATFORM_MASTER_PERMISSIONS.includes(permission)) {
        return account.platformRole === "PLATFORM_ADMIN" && account.platformMaster === true;
    }
    return PLATFORM_ROLE_PERMISSIONS[account.platformRole].includes(permission);
}
