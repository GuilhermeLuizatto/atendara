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
  // Tambem separada: o titular ajusta o proprio horario de atendimento diante
  // de um imprevisto sem receber o resto de `organization:update`.
  "agendaSettings:update",
  "organization:delete",
  "billing:manage",
  "member:read",
  "member:request",
  "member:invite",
  "member:update",
  "member:remove",
  "organizationBranding:update",
  "import:manage",
  "support:create",
  "support:read",
  "support:reply",
  "client:read",
  "client:create",
  "client:update",
  "client:delete",
  // Registrar e retirar consentimento de aviso. Separada de `client:update`
  // porque e prova, e nao dado de cadastro: so acrescenta ou retira registro,
  // nunca apaga o historico.
  "notificationConsent:record",
  // Catalogo de servicos (E2.1). Separado de `appointment:*` porque mexer no
  // preco do trabalho nao e o mesmo que marcar um horario.
  "service:read",
  "service:manage",
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
  // Fila de automacao (13.9). Ler a fila e ver estado, tentativas e motivo —
  // nunca texto de mensagem nem contato completo, que a fila nao guarda.
  "automationQueue:read",
  // Repetir uma tarefa que falhou. Separada da leitura porque faz sair
  // mensagem: quem vê o problema não é necessariamente quem decide reenviar.
  "automationTask:retry",
  // Desligar e religar toda a saida da organizacao. Do titular, como a chave
  // de casa: quem responde pela organizacao pode calar o sistema na hora.
  "automationSwitch:manage",
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
 * Vinculo de um usuario com sua unica organizacao. O e-mail do Auth e unico e
 * convites recusam contas existentes, impedindo participacao em outro tenant.
 */
export interface Membership extends TenantScopedEntity {
  /** UID do Firebase Authentication. */
  userId: ID | null;
  role: Role;
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "REMOVED";
  invitedBy: ID | null;
  /** Funcionarios podem apoiar mais de um profissional da mesma organizacao. */
  linkedProfessionalIds?: ID[];
  removedAt?: string | null;
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
  /**
   * E-mail confirmado. O cadastro aberto depende disto: enquanto for `false`, a
   * conta existe e nao abre nada. Quem decide e o token no servidor; aqui e so
   * o que a tela mostra.
   */
  emailVerified: boolean;
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
