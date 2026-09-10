import {
  withOrganizationDefaults,
  type PartialOrganization,
} from "@/config/organization";
import { getProfession } from "@/config/professions";
import { materializeSeededRules } from "@/config/system-rules";
import type {
  AIDecision,
  AIRule,
  Appointment,
  AuditLog,
  Client,
  Conversation,
  ID,
  ISODateString,
  Message,
  Notification,
  NotificationDelivery,
  Professional,
  ProfessionId,
  Transaction,
} from "@/types";

import { markOverdue, recomputeClientAggregates } from "../aggregates";
import type { WorkspaceSnapshot } from "../types";

/** Partes cruas vindas do Firestore, uma por listener. */
export interface SnapshotParts {
  organization: PartialOrganization | null;
  professionals: Professional[];
  clients: Client[];
  appointments: Appointment[];
  conversations: Conversation[];
  messages: Message[];
  transactions: Transaction[];
  aiRules: AIRule[];
  aiDecisions: AIDecision[];
  notifications: Notification[];
  notificationDeliveries: NotificationDelivery[];
  auditLogs: AuditLog[];
}

export function emptyParts(): SnapshotParts {
  return {
    organization: null,
    professionals: [],
    clients: [],
    appointments: [],
    conversations: [],
    messages: [],
    transactions: [],
    aiRules: [],
    aiDecisions: [],
    notifications: [],
    notificationDeliveries: [],
    auditLogs: [],
  };
}

/**
 * Monta a fotografia do tenant a partir das colecoes do Firestore.
 *
 * Duas coisas acontecem aqui e em nenhum outro lugar:
 *
 * 1. **Regras semeadas entram por composicao.** SECURITY, SYSTEM e PROFESSION
 *    vem de `src/config`, nunca do banco. Regra fundamental sem documento e
 *    regra que ninguem consegue editar, desativar ou apagar.
 * 2. **Agregados derivados sao recalculados.** `totalAppointments`, saldo em
 *    aberto e vencimento em atraso saem da agenda e do financeiro ja carregados
 *    — em vez de reescrever todo cadastro a cada mutacao. Os campos gravados no
 *    documento sao cache; a leitura e a verdade.
 */
export function assembleSnapshot(
  parts: SnapshotParts,
  organizationId: ID,
  professionId: ProfessionId,
  now: ISODateString,
): WorkspaceSnapshot | null {
  if (!parts.organization) return null;

  const organization = withOrganizationDefaults(
    parts.organization,
    organizationId,
    professionId,
    now,
  );

  const seededRules = materializeSeededRules(
    organizationId,
    getProfession(organization.primaryProfession),
    organization.createdAt,
  );

  const transactions = markOverdue(parts.transactions, now);
  const clients = recomputeClientAggregates(
    parts.clients,
    parts.appointments,
    transactions,
    now,
  );

  return {
    organization,
    professionals: parts.professionals,
    clients,
    appointments: [...parts.appointments].sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    ),
    conversations: parts.conversations,
    // A consulta traz as mais recentes primeiro; a conversa e lida do inicio.
    messages: [...parts.messages].sort((a, b) =>
      a.sentAt.localeCompare(b.sentAt),
    ),
    transactions,
    rules: [
      ...seededRules,
      // Uma regra editavel nunca sobrepoe uma fundamental: os ids das semeadas
      // sao reservados e um documento com o mesmo id e ignorado.
      ...parts.aiRules.filter(
        (rule) =>
          !rule.immutable && !seededRules.some((seed) => seed.id === rule.id),
      ),
    ],
    decisions: parts.aiDecisions,
    notifications: parts.notifications,
    notificationDeliveries: parts.notificationDeliveries,
    auditLogs: parts.auditLogs,
  };
}
