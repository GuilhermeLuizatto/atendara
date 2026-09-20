import { getProfession } from "@/config/professions";
import { AESTHETICS_SERVICE_SEEDS } from "@/config/services";
// Importado do arquivo, nao do barril `@/services`: o barril carrega o
// repositorio, que por sua vez importa este modulo — o ciclo quebraria.
import type { WorkspaceSnapshot } from "@/services/types";
import type { ProfessionId } from "@/types";

import { toDateKey } from "./dates";
import { Rng } from "./random";
import {
  applyAppointmentAggregates,
  buildAppointments,
} from "./generators/agenda";
import type { GeneratorContext } from "./generators/context";
import {
  applyOutstandingBalances,
  buildTransactions,
} from "./generators/finance";
import {
  buildAuditLogs,
  buildNotifications,
  buildRules,
} from "./generators/governance";
import { buildInbox } from "./generators/inbox";
import { buildOrganization } from "./generators/organization";
import { buildClients, buildProfessionals } from "./generators/people";

/**
 * O conjunto ficticio tem exatamente a forma que o repositorio entrega. Assim a
 * origem dos dados pode trocar sem que nenhuma tela perceba.
 */
export type MockDataset = WorkspaceSnapshot;

/**
 * Monta o conjunto completo de dados ficticios de uma profissao.
 *
 * A ordem importa: agenda deriva de clientes, financeiro deriva da agenda,
 * decisoes derivam das regras e alertas derivam das decisoes. E a mesma cadeia
 * causal do produto real — por isso os numeros das telas batem entre si.
 */
export function buildMockDataset(
  professionId: ProfessionId,
  anchor: Date = new Date(),
): MockDataset {
  const profession = getProfession(professionId);
  const ctx: GeneratorContext = {
    rng: new Rng(professionId),
    profession,
    organizationId: `org-${professionId.toLowerCase()}`,
    today: toDateKey(anchor),
    now: anchor.toISOString(),
  };

  const professionals = buildProfessionals(ctx);
  const organization = buildOrganization(ctx, professionals[0].id);

  let clients = buildClients(ctx, professionals);
  const appointments = buildAppointments(ctx, clients, professionals);
  clients = applyAppointmentAggregates(clients, appointments, ctx.now);

  const transactions = buildTransactions(ctx, appointments);
  clients = applyOutstandingBalances(clients, transactions);

  const rules = buildRules(ctx);
  const { conversations, messages, decisions } = buildInbox(
    ctx,
    clients,
    rules,
  );

  const notifications = buildNotifications(
    ctx,
    decisions,
    appointments,
    transactions,
    clients,
  );
  const auditLogs = buildAuditLogs(ctx, rules, decisions);

  return {
    organization,
    professionals,
    clients,
    // Sugestoes sem preco e desligadas, como na organizacao de verdade: a
    // demonstracao nao inventa valor em reais (decisao de 13/09).
    services: profession.features.serviceCatalog
      ? AESTHETICS_SERVICE_SEEDS.map((seed, index) => ({
          id: `servico-${index + 1}`,
          organizationId: organization.id,
          createdAt: organization.createdAt,
          createdBy: null,
          updatedAt: organization.createdAt,
          updatedBy: null,
          position: index,
          archivedAt: null,
          ...seed,
        }))
      : [],
    appointments,
    conversations,
    messages,
    transactions,
    rules,
    decisions,
    notifications,
    // Vazia por construcao: a demonstracao nao simula mensagem enviada a
    // ninguem, e mock nao e historico que possa virar envio.
    notificationDeliveries: [],
    auditLogs,
  };
}

const cache = new Map<string, MockDataset>();

/**
 * Versao memoizada. A chave inclui a data para que o conjunto seja refeito
 * quando o dia virar, mantendo "atendimentos de hoje" realmente de hoje.
 */
export function getMockDataset(
  professionId: ProfessionId,
  anchor: Date = new Date(),
): MockDataset {
  const key = `${professionId}:${toDateKey(anchor)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const dataset = buildMockDataset(professionId, anchor);
  cache.set(key, dataset);
  return dataset;
}
