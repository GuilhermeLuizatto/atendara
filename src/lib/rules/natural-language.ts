import { RULE_CATEGORY_LABELS } from "@/config/labels";
import type {
  RuleAction,
  RuleCategory,
  RuleCondition,
  RuleDraft,
} from "@/types";

/**
 * Interpretacao de regra escrita em linguagem natural.
 *
 * O texto do usuario NUNCA vira prompt. Ele e traduzido para uma regra
 * estruturada, que o proprio usuario revisa e confirma antes de valer. Isso
 * mantem tres propriedades que um prompt solto nao tem: a regra e auditavel,
 * respeita a hierarquia de precedencia e nao pode ser reinterpretada de forma
 * diferente a cada execucao.
 *
 * A heuristica abaixo e proposital: quando nao reconhece algo, ela BAIXA a
 * confianca e registra um aviso, em vez de adivinhar.
 */

interface CategoryMatcher {
  category: RuleCategory;
  terms: string[];
  topic: string;
}

const CATEGORY_MATCHERS: CategoryMatcher[] = [
  {
    category: "PRICING",
    terms: ["preco", "valor", "quanto custa", "custa", "honorario"],
    topic: "PRICING",
  },
  {
    category: "SCHEDULING",
    terms: ["horario", "agenda", "disponibilidade", "vaga", "marcar"],
    topic: "SCHEDULING",
  },
  {
    category: "RESCHEDULING",
    terms: ["remarcar", "reagendar", "adiar", "trocar o dia"],
    topic: "RESCHEDULING",
  },
  {
    category: "CONFIRMATION",
    terms: ["confirmar", "confirmacao"],
    topic: "CONFIRMATION",
  },
  {
    category: "CANCELLATION",
    terms: ["cancelar", "desmarcar", "cancelamento"],
    topic: "CANCELLATION",
  },
  {
    category: "LOCATION",
    terms: ["endereco", "localizacao", "onde fica", "estacionamento"],
    topic: "LOCATION",
  },
  {
    category: "PAYMENT",
    terms: ["pagamento", "pix", "cartao", "boleto", "recibo", "nota fiscal"],
    topic: "PAYMENT",
  },
  {
    category: "AVAILABILITY",
    terms: ["domingo", "sabado", "feriado", "fim de semana", "nao atendo"],
    topic: "AVAILABILITY",
  },
  {
    category: "SERVICES",
    terms: ["convenio", "plano de saude", "como funciona", "primeira consulta"],
    topic: "SERVICES",
  },
];

const NEGATION_TERMS = [
  "nao ",
  "nunca ",
  "jamais ",
  "evite ",
  "nao pode",
  "nao deve",
];

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function interpretRuleText(input: string): RuleDraft {
  const raw = input.trim();
  const text = normalize(raw);
  const warnings: string[] = [];

  // 1. Categoria: qual assunto a regra trata.
  const matcher = CATEGORY_MATCHERS.map((candidate) => ({
    ...candidate,
    specificity: Math.max(
      0,
      ...candidate.terms
        .filter((term) => text.includes(term))
        .map((term) => term.length),
    ),
  }))
    .sort((a, b) => b.specificity - a.specificity)
    .find((candidate) => candidate.specificity > 0);

  if (!matcher) {
    warnings.push(
      "Nao identificamos o assunto da regra. Revise a categoria antes de ativar.",
    );
  }

  const category: RuleCategory = matcher?.category ?? "GENERAL";
  const topic = matcher?.topic ?? "GENERAL";

  // 2. Sentido: autorizar ou proibir.
  const negated = NEGATION_TERMS.some((term) => text.includes(term));

  // 3. Condicoes reconhecidas no texto.
  const conditions: RuleCondition[] = [
    {
      field: "message.classification",
      operator: "EQUALS",
      value: "ADMINISTRATIVE",
    },
  ];

  if (text.includes("online")) {
    conditions.push({
      field: "client.modality",
      operator: "EQUALS",
      value: "ONLINE",
    });
  } else if (text.includes("presencial")) {
    conditions.push({
      field: "client.modality",
      operator: "EQUALS",
      value: "IN_PERSON",
    });
  }

  for (const [name, index] of Object.entries(WEEKDAYS)) {
    if (text.includes(name)) {
      conditions.push({
        field: "context.dayOfWeek",
        operator: "EQUALS",
        value: index,
      });
      break;
    }
  }

  // 4. Valores citados viram payload, nunca texto solto para o modelo.
  const priceMatch = raw.match(/R\$\s?([\d.]+(?:,\d{2})?)/i);
  const durationMatch = text.match(/(\d{2,3})\s?(?:min|minutos)/);

  const payload: Record<string, string | number | boolean> = { topic };
  if (priceMatch) {
    const [whole, cents = "00"] = priceMatch[1].replace(/\./g, "").split(",");
    const amountInCents = Number(whole) * 100 + Number(cents);
    if (Number.isSafeInteger(amountInCents))
      payload.priceInCents = amountInCents;
  }
  if (durationMatch) payload.durationMinutes = Number(durationMatch[1]);

  const actions: RuleAction[] = [
    { type: negated ? "DENY_TOPIC" : "ALLOW_TOPIC", payload },
  ];

  // 5. Confianca: cai a cada coisa que a heuristica nao reconheceu.
  let confidence = 0.9;
  if (!matcher) confidence -= 0.4;
  if (raw.length < 15) {
    confidence -= 0.15;
    warnings.push("Texto muito curto para uma interpretacao segura.");
  }
  if (priceMatch && !matcher) {
    warnings.push("Valor identificado, mas sem assunto claro associado.");
  }
  if (conditions.length === 1 && text.includes(" se ")) {
    warnings.push(
      "Ha uma condicao no texto que nao foi reconhecida. Revise antes de ativar.",
    );
    confidence -= 0.15;
  }

  const name = matcher
    ? `${negated ? "Nao informar" : "Informar"} ${RULE_CATEGORY_LABELS[matcher.category].toLowerCase()}`
    : "Regra personalizada";

  return {
    name,
    description: raw,
    category,
    conditions: { combinator: "AND", conditions },
    actions,
    confidence: Math.max(0.15, Math.min(0.95, confidence)),
    warnings,
    sourceText: raw,
  };
}
