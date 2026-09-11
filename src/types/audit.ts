import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { PrivacyRedactionMark } from "./privacy";

export type AuditActorType = "USER" | "AI_AGENT" | "SYSTEM";

export const AUDIT_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "READ_SENSITIVE",
  "LOGIN",
  "LOGOUT",
  "RULE_ENABLED",
  "RULE_DISABLED",
  "AI_AUTO_RESPONSE",
  "AI_ESCALATION",
  "PERMISSION_CHANGED",
  "EXPORT",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditResourceRef {
  type: string;
  id: ID;
}

/**
 * Log de auditoria. Apenas escrita: as Security Rules permitem `create` e
 * negam `update`/`delete` para qualquer papel, inclusive OWNER. A unica
 * alteracao possivel e a pseudonimizacao pelo backend, marcada em
 * `privacyRedaction` — a entrada continua existindo.
 */
export interface AuditLog extends TenantScopedEntity {
  actorType: AuditActorType;
  actorId: ID | null;
  actorName: string;
  action: AuditAction;
  resource: AuditResourceRef;
  /** Resumo legivel. Nao deve conter conteudo sensivel de conversas. */
  summary: string;
  metadata: Record<string, string | number | boolean | null>;
  occurredAt: ISODateString;
  privacyRedaction?: PrivacyRedactionMark | null;
}
