import type { AIRule, ID, ISODateString } from "@/types";

/**
 * Regras fundamentais (Nivel 1).
 *
 * Sao semeadas em toda organizacao, marcadas como `immutable` e recusadas pelas
 * Security Rules em qualquer tentativa de update ou delete. A interface as
 * exibe em modo leitura, sem toggle.
 *
 * `SECURITY` trata de isolamento e permissao — invariantes da plataforma.
 * `SYSTEM` trata do comportamento do agente — invariantes do produto.
 */

export type SystemRuleDefinition = Omit<
  AIRule,
  | "id"
  | "organizationId"
  | "createdAt"
  | "updatedAt"
  | "createdBy"
  | "updatedBy"
> & { key: string };

function systemRule(
  rule: Omit<
    SystemRuleDefinition,
    | "professionalId"
    | "enabled"
    | "immutable"
    | "source"
    | "version"
    | "naturalLanguageInput"
    | "lastAppliedAt"
  >,
): SystemRuleDefinition {
  return {
    ...rule,
    professionalId: null,
    enabled: true,
    immutable: true,
    source: "SYSTEM",
    version: 1,
    naturalLanguageInput: null,
    lastAppliedAt: null,
  };
}

export const SYSTEM_RULES: SystemRuleDefinition[] = [
  systemRule({
    key: "tenant-isolation",
    name: "Nunca acessar dados de outra organizacao",
    description:
      "O agente opera exclusivamente dentro do tenant da conversa. Qualquer leitura fora dele e negada pelas Security Rules antes de chegar ao motor.",
    level: "SECURITY",
    category: "PRIVACY",
    priority: 1000,
    conditions: { combinator: "AND", conditions: [] },
    actions: [{ type: "BLOCK", payload: { scope: "cross-tenant" } }],
  }),
  systemRule({
    key: "respect-permissions",
    name: "Nunca executar acao sem permissao",
    description:
      "O agente nao realiza nenhuma acao que o papel do profissional responsavel nao autorize.",
    level: "SECURITY",
    category: "PRIVACY",
    priority: 990,
    conditions: { combinator: "AND", conditions: [] },
    actions: [{ type: "REQUIRE_HUMAN_APPROVAL", payload: null }],
  }),
  systemRule({
    key: "no-private-data-disclosure",
    name: "Nunca revelar dados privados",
    description:
      "Dados de outros clientes, informacoes financeiras de terceiros e conteudo de conversas nunca sao divulgados.",
    level: "SECURITY",
    category: "PRIVACY",
    priority: 980,
    conditions: { combinator: "AND", conditions: [] },
    actions: [{ type: "DENY_TOPIC", payload: { topic: "private-data" } }],
  }),
  systemRule({
    key: "no-hallucination",
    name: "Nunca inventar informacoes",
    description:
      "O agente responde apenas com informacao presente nas regras ativas ou nos dados da organizacao. Sem fonte, escala.",
    level: "SYSTEM",
    category: "SAFETY",
    priority: 900,
    conditions: { combinator: "AND", conditions: [] },
    actions: [{ type: "ESCALATE", payload: { reason: "sem-fonte" } }],
  }),
  systemRule({
    key: "no-impersonation",
    name: "Nunca se passar pelo profissional",
    description:
      "O agente se identifica como assistente em toda resposta automatica. Nao assina como o profissional.",
    level: "SYSTEM",
    category: "IDENTITY",
    priority: 890,
    conditions: { combinator: "AND", conditions: [] },
    actions: [{ type: "AUTO_RESPONSE", payload: { requireDisclosure: true } }],
  }),
  systemRule({
    key: "risk-always-escalates",
    name: "Nunca ignorar possivel situacao de risco",
    description:
      "Mensagem classificada como possivel risco interrompe a automacao, gera alerta critico e aguarda o profissional.",
    level: "SYSTEM",
    category: "ESCALATION",
    priority: 880,
    conditions: {
      combinator: "AND",
      conditions: [
        {
          field: "message.classification",
          operator: "EQUALS",
          value: "POSSIBLE_RISK",
        },
      ],
    },
    actions: [
      { type: "ESCALATE", payload: { immediate: true } },
      { type: "CREATE_ALERT", payload: { priority: "CRITICAL" } },
    ],
  }),
  systemRule({
    key: "administrative-only",
    name: "Responder automaticamente apenas assuntos administrativos",
    description:
      "Somente mensagens classificadas como administrativas podem receber resposta automatica. Qualquer outra classificacao vai para o profissional.",
    level: "SYSTEM",
    category: "SAFETY",
    priority: 870,
    conditions: {
      combinator: "AND",
      conditions: [
        {
          field: "message.classification",
          operator: "NOT_EQUALS",
          value: "ADMINISTRATIVE",
        },
      ],
    },
    actions: [{ type: "ESCALATE", payload: { reason: "nao-administrativo" } }],
  }),
  systemRule({
    key: "unknown-escalates",
    name: "Na duvida, escalar",
    description:
      "Intencao nao reconhecida ou confianca abaixo do limite configurado sempre resulta em encaminhamento ao profissional.",
    level: "SYSTEM",
    category: "ESCALATION",
    priority: 860,
    conditions: {
      combinator: "OR",
      conditions: [
        {
          field: "message.classification",
          operator: "EQUALS",
          value: "UNKNOWN",
        },
      ],
    },
    actions: [{ type: "ESCALATE", payload: { reason: "baixa-confianca" } }],
  }),
  systemRule({
    key: "no-lower-level-override",
    name: "Nenhuma regra inferior sobrescreve uma superior",
    description:
      "A precedencia entre niveis e resolvida pelo motor. Uma regra do profissional nao pode liberar o que uma regra fundamental proibe.",
    level: "SYSTEM",
    category: "SAFETY",
    priority: 850,
    conditions: { combinator: "AND", conditions: [] },
    actions: [{ type: "BLOCK", payload: { scope: "rule-precedence" } }],
  }),
];

/** Materializa as regras fundamentais para uma organizacao especifica. */
export function materializeSystemRules(
  organizationId: ID,
  now: ISODateString,
): AIRule[] {
  return SYSTEM_RULES.map(({ key, ...rule }) => ({
    ...rule,
    id: `sys-${key}`,
    organizationId,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
  }));
}
