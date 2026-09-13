// Gerado por scripts/build-functions.mjs.
export const ROLES = [
    "OWNER",
    "ADMIN",
    "PROFESSIONAL",
    "ASSISTANT",
    "VIEWER",
];
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
    // Tambem separada: o titular ajusta o proprio horario de atendimento diante
    // de um imprevisto sem receber o resto de `organization:update`.
    "agendaSettings:update",
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
    // Registrar e retirar consentimento de aviso. Separada de `client:update`
    // porque e prova, e nao dado de cadastro: so acrescenta ou retira registro,
    // nunca apaga o historico.
    "notificationConsent:record",
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
];
