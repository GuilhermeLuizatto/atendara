import type { MessageClassificationId, ProfessionConfig } from "@/types";

/**
 * Classificador de mensagens.
 *
 * E uma heuristica lexical determinística, nao um modelo de linguagem. A troca
 * por um LLM real acontece atras desta mesma assinatura — o motor de decisao
 * consome `ClassificationResult` e nao sabe como ele foi produzido.
 *
 * Determinismo importa mais do que sofisticacao nesta fase: permite testar o
 * comportamento do agente ponta a ponta, sem rede e sem variacao entre
 * execucoes.
 */

export type AdminIntent =
  | "PRICING"
  | "SCHEDULING"
  | "RESCHEDULING"
  | "CONFIRMATION"
  | "CANCELLATION"
  | "LOCATION"
  | "PAYMENT"
  | "SERVICES";

export interface ClassificationResult {
  classification: MessageClassificationId;
  confidence: number;
  intent: AdminIntent | "NONE";
  matchedTerms: string[];
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Sinais de risco.
 *
 * Deliberadamente amplos e avaliados ANTES de tudo. Um falso positivo custa uma
 * notificacao a mais para o profissional; um falso negativo custa uma pessoa
 * sem resposta. A assimetria justifica a sensibilidade.
 */
const RISK_TERMS = [
  "nao estou bem",
  "nao aguento",
  "nao consigo mais",
  "nao sei o que fazer",
  "preciso muito falar",
  "preciso falar com voce",
  "momento dificil",
  "estou muito mal",
  "estou desesperad",
  "crise",
  "panico",
  "sozinh",
  "sem saida",
  "quero desistir",
  "me machucar",
  "socorro",
];

const ADMIN_INTENT_TERMS: Record<AdminIntent, string[]> = {
  PRICING: [
    "valor",
    "preco",
    "quanto custa",
    "quanto e a",
    "quanto fica",
    "custa",
  ],
  SCHEDULING: [
    "horario",
    "disponivel",
    "vaga",
    "tem agenda",
    "atende no",
    "atende aos",
    "encaixe",
    "marcar",
    "agendar",
  ],
  RESCHEDULING: [
    "remarcar",
    "reagendar",
    "mudar o horario",
    "trocar o dia",
    "passar para",
    "adiar",
  ],
  CONFIRMATION: ["confirmar", "confirmado", "esta de pe", "continua valendo"],
  CANCELLATION: ["cancelar", "desmarcar", "nao vou poder ir"],
  LOCATION: [
    "endereco",
    "onde fica",
    "onde e",
    "estacionamento",
    "como chego",
    "referencia",
  ],
  PAYMENT: [
    "pix",
    "cartao",
    "pagamento",
    "pagar",
    "boleto",
    "recibo",
    "nota fiscal",
    "reembolso",
    "transferencia",
  ],
  SERVICES: ["convenio", "plano de saude", "como funciona", "primeira vez"],
};

const CLASSIFICATION_TERMS: Partial<Record<MessageClassificationId, string[]>> =
  {
    CLINICAL: [
      "sintoma",
      "remedio",
      "medicacao",
      "dose",
      "receita",
      "exame",
      "diagnostico",
      "tratamento",
      "efeito colateral",
      "restauracao",
      "sensivel ao",
      "plano alimentar",
      "substituir",
      "trocar a batata",
      "sessao passada",
      "ultima sessao",
      "terapeutic",
    ],
    TRAINING: [
      "treino",
      "serie",
      "carga",
      "exercicio",
      "agachamento",
      "supino",
      "cardio",
      "repeticao",
      "musculacao",
      "leg press",
      "aumentar a carga",
    ],
    HEALTH_RELATED: [
      "dor",
      "lesao",
      "machuquei",
      "estalo",
      "inchad",
      "torci",
      "passar mal",
      "intolerancia",
      "desconforto",
      "incomodo",
    ],
    URGENT: [
      "urgente",
      "emergencia",
      "ainda hoje",
      "agora mesmo",
      "nao posso esperar",
      "quebrou",
      "piora",
    ],
    PROFESSIONAL: [
      "sua opiniao",
      "o que voce acha",
      "me diz o que",
      "aconteceu esta semana",
      "queria te contar",
    ],
    FINANCIAL: ["nota fiscal", "reembolso", "boleto venceu", "comprovante"],
  };

/**
 * Ordem de desempate entre classificacoes.
 *
 * Uma mensagem como "quanto custa? estou com dor no joelho" tem sinal
 * administrativo E de saude. O sinal mais sensivel vence sempre — responder o
 * preco e ignorar a dor seria o pior resultado possivel.
 */
const SEVERITY_ORDER: MessageClassificationId[] = [
  "POSSIBLE_RISK",
  "URGENT",
  "HEALTH_RELATED",
  "CLINICAL",
  "PROFESSIONAL",
  "TRAINING",
  "FINANCIAL",
  "ADMINISTRATIVE",
  "UNKNOWN",
];

function countMatches(haystack: string, terms: string[]): string[] {
  return terms.filter((term) => haystack.includes(term));
}

function confidenceFor(matches: number, base: number): number {
  return Math.min(0.98, base + matches * 0.11);
}

export function classifyMessage(
  text: string,
  profession: ProfessionConfig,
): ClassificationResult {
  const normalized = normalize(text);
  const enabled = new Set(profession.messageClassifications);

  // 1. Risco tem passagem propria, antes de qualquer pontuacao.
  const riskMatches = countMatches(normalized, RISK_TERMS);
  if (riskMatches.length > 0 && enabled.has("POSSIBLE_RISK")) {
    return {
      classification: "POSSIBLE_RISK",
      confidence: confidenceFor(riskMatches.length, 0.82),
      intent: "NONE",
      matchedTerms: riskMatches,
    };
  }

  // 2. Pontua cada classificacao habilitada para a profissao.
  const scored = new Map<MessageClassificationId, string[]>();
  for (const [classification, terms] of Object.entries(CLASSIFICATION_TERMS)) {
    const id = classification as MessageClassificationId;
    const matches = countMatches(normalized, terms ?? []);
    if (matches.length > 0) {
      // Um sinal sensivel continua bloqueando automacao mesmo sem categoria especifica na profissao.
      const target = enabled.has(id)
        ? id
        : enabled.has("PROFESSIONAL")
          ? "PROFESSIONAL"
          : "UNKNOWN";
      scored.set(target, [...(scored.get(target) ?? []), ...matches]);
    }
  }

  if (scored.has("UNKNOWN")) {
    return {
      classification: "UNKNOWN",
      confidence: 0.72,
      intent: "NONE",
      matchedTerms: scored.get("UNKNOWN") ?? [],
    };
  }

  // 3. Intencao administrativa.
  let bestIntent: AdminIntent | "NONE" = "NONE";
  let bestIntentMatches: string[] = [];
  for (const [intent, terms] of Object.entries(ADMIN_INTENT_TERMS)) {
    const matches = countMatches(normalized, terms);
    if (matches.length > bestIntentMatches.length) {
      bestIntent = intent as AdminIntent;
      bestIntentMatches = matches;
    }
  }
  if (bestIntentMatches.length > 0 && enabled.has("ADMINISTRATIVE")) {
    // "Remarcar" contem "marcar": a intencao especifica precisa prevalecer.
    for (const intent of [
      "CANCELLATION",
      "RESCHEDULING",
      "CONFIRMATION",
    ] as const) {
      const matches = countMatches(normalized, ADMIN_INTENT_TERMS[intent]);
      if (matches.length) {
        bestIntent = intent;
        bestIntentMatches = matches;
        break;
      }
    }
    scored.set("ADMINISTRATIVE", bestIntentMatches);
  }

  // 4. Desempate por severidade, nao por quantidade de termos.
  for (const candidate of SEVERITY_ORDER) {
    const matches = scored.get(candidate);
    if (!matches) continue;

    return {
      classification: candidate,
      confidence: confidenceFor(matches.length, 0.72),
      intent: candidate === "ADMINISTRATIVE" ? bestIntent : "NONE",
      matchedTerms: matches,
    };
  }

  // 5. Nenhum sinal reconhecido. Confianca baixa de proposito: e o que faz o
  //    motor escalar em vez de arriscar uma resposta.
  return {
    classification: "UNKNOWN",
    confidence: 0.32,
    intent: "NONE",
    matchedTerms: [],
  };
}
