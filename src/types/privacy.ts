import type { ID, ISODateString, TenantScopedEntity } from "./common";

/**
 * Direitos do titular dos dados — o lado tecnico.
 *
 * Quem atende o pedido de um cliente (paciente, aluno) e a ORGANIZACAO que o
 * atende: e ela quem responde pelo cadastro. O backend executa e deixa
 * registro. Nada aqui afirma conformidade com norma nenhuma; o que o codigo
 * faz com cada colecao esta em `src/config/privacy.ts`, e prazos e excecoes a
 * eliminacao sao decisao juridica ainda pendente.
 *
 * Transpilado para `functions/generated/privacy-types.js`.
 */

export const PRIVACY_REQUEST_TYPES = [
  "CLIENT_EXPORT",
  "CLIENT_ERASURE",
  "ORGANIZATION_EXPORT",
] as const;

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

/**
 * Por onde o pedido chegou. Lista fechada de proposito: um campo de texto livre
 * seria preenchido com nome e contato de quem pediu, e a trilha do pedido de
 * eliminacao passaria a guardar exatamente o que foi eliminado.
 */
export const PRIVACY_REQUEST_CHANNELS = [
  "IN_PERSON",
  "EMAIL",
  "PHONE",
  "MESSAGE",
  "LETTER",
  "OTHER",
] as const;

export type PrivacyRequestChannel = (typeof PRIVACY_REQUEST_CHANNELS)[number];

/**
 * Secoes da exportacao da organizacao. Uma por colecao do tenant — o teste de
 * `src/config/privacy.test.ts` confere contra `TENANT_COLLECTIONS`, para que
 * uma colecao nova nao fique fora da exportacao em silencio.
 */
export const ORGANIZATION_EXPORT_SECTIONS = [
  "members",
  "professionals",
  "clients",
  "appointments",
  "conversations",
  "messages",
  "transactions",
  "aiRules",
  "aiDecisions",
  "notifications",
  "notificationDeliveries",
  "automationTasks",
  "auditLogs",
  "privacyRequests",
] as const;

export type OrganizationExportSection =
  (typeof ORGANIZATION_EXPORT_SECTIONS)[number];

export type RedactionScope = "CLIENT_ERASURE" | "ORGANIZATION_DELETION";

/**
 * Marca gravada em cada documento pseudonimizado. Quem ler a trilha depois ve
 * que o conteudo foi retirado, quando e por qual pedido — em vez de achar que
 * o registro sempre foi vazio.
 */
export interface PrivacyRedactionMark {
  scope: RedactionScope;
  requestId: ID;
  redactedAt: ISODateString;
}

export interface PrivacyRequestCount {
  exported: number;
  deleted: number;
  pseudonymized: number;
}

/**
 * Registro de um pedido atendido, em `organizations/{orgId}/privacyRequests`.
 * Escrito so pelo backend, junto do ato. Nao guarda nome, contato nem texto de
 * quem pediu.
 */
export interface PrivacyRequest extends TenantScopedEntity {
  type: PrivacyRequestType;
  /**
   * `clientId` enquanto o cadastro existe. Depois da eliminacao, o pseudonimo:
   * o proprio registro de uma exportacao anterior deixa de apontar para a
   * pessoa. `null` na exportacao da organizacao.
   */
  subjectId: ID | null;
  receivedVia: PrivacyRequestChannel | null;
  requestedBy: ID;
  executedAt: ISODateString;
  counts: Record<string, PrivacyRequestCount>;
}

/** Linha da trilha de auditoria entregue ao titular, sem o nome da equipe. */
export interface ExportedAuditEntry {
  id: ID;
  action: string;
  occurredAt: ISODateString | null;
  resourceType: string | null;
  summary: string | null;
}

/** Arquivo entregue a quem pediu os proprios dados. Datas em ISO-8601. */
export interface ClientDataExport {
  format: "atendara.titular";
  version: 1;
  requestId: ID;
  generatedAt: ISODateString;
  organization: { id: ID; name: string | null };
  subject: Record<string, unknown>;
  appointments: Record<string, unknown>[];
  conversations: Array<Record<string, unknown> & { messages: Record<string, unknown>[] }>;
  transactions: Record<string, unknown>[];
  notificationDeliveries: Record<string, unknown>[];
  /** Execucoes da fila de automacao ligadas a esta pessoa: ids e estado, sem texto. */
  automationTasks: Record<string, unknown>[];
  /** Decisoes automatizadas tomadas sobre mensagens desta pessoa. */
  aiDecisions: Record<string, unknown>[];
  auditTrail: ExportedAuditEntry[];
}

export interface PrivacyOperationResult {
  requestId: ID;
  counts: Record<string, PrivacyRequestCount>;
}

export interface OrganizationExportStart {
  exportId: ID;
  organization: Record<string, unknown>;
  sections: OrganizationExportSection[];
}

export interface OrganizationExportCursor {
  id: ID;
  /** So na secao `messages`, que atravessa as conversas. */
  conversationId?: ID;
}

export interface OrganizationExportPage {
  section: OrganizationExportSection;
  documents: Array<{ id: ID; conversationId?: ID; data: Record<string, unknown> }>;
  nextCursor: OrganizationExportCursor | null;
}
