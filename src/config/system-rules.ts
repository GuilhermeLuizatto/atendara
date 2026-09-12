import type {
  AIRule,
  ID,
  ISODateString,
  ProfessionConfig,
  RuleCategory,
} from "@/types";

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
    name: "Nunca acessar dados de outra organização",
    description:
      "O agente opera exclusivamente dentro do tenant da conversa. Qualquer leitura fora dele é negada pelas Security Rules antes de chegar ao motor.",
    level: "SECURITY",
    category: "PRIVACY",
    priority: 1000,
    conditions: { combinator: "AND", conditions: [] },
    actions: [{ type: "BLOCK", payload: { scope: "cross-tenant" } }],
  }),
  systemRule({
    key: "respect-permissions",
    name: "Nunca executar ação sem permissão",
    description:
      "O agente não realiza nenhuma ação que o papel do profissional responsável não autorize.",
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
      "Dados de outros clientes, informações financeiras de terceiros e conteúdo de conversas nunca são divulgados.",
    level: "SECURITY",
    category: "PRIVACY",
    priority: 980,
    conditions: { combinator: "AND", conditions: [] },
    actions: [{ type: "DENY_TOPIC", payload: { topic: "private-data" } }],
  }),
  systemRule({
    key: "no-hallucination",
    name: "Nunca inventar informações",
    description:
      "O agente responde apenas com informação presente nas regras ativas ou nos dados da organização. Sem fonte, escala.",
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
      "O agente se identifica como assistente em toda resposta automática. Não assina como o profissional.",
    level: "SYSTEM",
    category: "IDENTITY",
    priority: 890,
    conditions: { combinator: "AND", conditions: [] },
    actions: [{ type: "AUTO_RESPONSE", payload: { requireDisclosure: true } }],
  }),
  systemRule({
    key: "risk-always-escalates",
    name: "Nunca ignorar possível situação de risco",
    description:
      "Mensagem classificada como possível risco interrompe a automação, gera alerta crítico e aguarda o profissional.",
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
      "Somente mensagens classificadas como administrativas podem receber resposta automática. Qualquer outra classificação vai para o profissional.",
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
    name: "Na dúvida, escalar",
    description:
      "Intenção não reconhecida ou confiança abaixo do limite configurado sempre resulta em encaminhamento ao profissional.",
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
      "A precedência entre níveis é resolvida pelo motor. Uma regra do profissional não pode liberar o que uma regra fundamental proíbe.",
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

/**
 * Materializa as regras de nivel PROFESSION a partir do template da profissao.
 *
 * Assim como as fundamentais, elas nao sao criadas pelo usuario nem gravadas
 * pelo cliente: as Security Rules recusam `create` nos niveis SECURITY, SYSTEM
 * e PROFESSION. Deriva-las da tabela de profissoes garante que toda organizacao
 * — inclusive uma criada antes de um template mudar — enxergue exatamente o
 * mesmo conjunto, sem documento a adulterar.
 */
export function materializeProfessionRules(
  organizationId: ID,
  profession: ProfessionConfig,
  now: ISODateString,
): AIRule[] {
  return profession.suggestedRules.map((seed, index) => ({
    id: `profession-${profession.id.toLowerCase()}-${index + 1}`,
    organizationId,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    professionalId: null,
    name: seed.name,
    description: seed.description,
    level: "PROFESSION",
    category: seed.category as RuleCategory,
    enabled: seed.enabled,
    priority: 500 - index,
    conditions: {
      combinator: "AND",
      conditions: [
        {
          field: "message.classification",
          operator: seed.action === "ALLOW_TOPIC" ? "EQUALS" : "NOT_EQUALS",
          value: "ADMINISTRATIVE",
        },
      ],
    },
    actions: [{ type: seed.action, payload: { topic: seed.category } }],
    source: "PROFESSION_TEMPLATE",
    immutable: true,
    version: 1,
    naturalLanguageInput: null,
    lastAppliedAt: null,
  }));
}

/** Conjunto completo de regras que nao vivem no banco: fundamentais + profissao. */
export function materializeSeededRules(
  organizationId: ID,
  profession: ProfessionConfig,
  now: ISODateString,
): AIRule[] {
  return [
    ...materializeSystemRules(organizationId, now),
    ...materializeProfessionRules(organizationId, profession, now),
  ];
}
