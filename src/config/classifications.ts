import type {
  MessageClassificationId,
  MessageClassificationMeta,
} from "@/types";

/**
 * Metadata das classificacoes.
 *
 * `autoResponseEligible` e a trava mais importante do produto: somente
 * `ADMINISTRATIVE` pode receber resposta automatica. Qualquer outra coisa —
 * clinica, treino, urgencia, risco ou desconhecida — vai para o profissional.
 * O motor le esta tabela; nao existe condicional por profissao em codigo.
 */
export const CLASSIFICATION_META: Record<
  MessageClassificationId,
  MessageClassificationMeta
> = {
  ADMINISTRATIVE: {
    id: "ADMINISTRATIVE",
    label: "Administrativo",
    description:
      "Horários, preços, endereço, confirmação, remarcação, pagamento.",
    tone: "informative",
    autoResponseEligible: true,
    alwaysEscalates: false,
    sensitive: false,
  },
  PROFESSIONAL: {
    id: "PROFESSIONAL",
    label: "Técnico",
    description:
      "Dúvida que exige julgamento do profissional. Nunca respondida pelo agente.",
    tone: "professional",
    autoResponseEligible: false,
    alwaysEscalates: true,
    sensitive: true,
  },
  CLINICAL: {
    id: "CLINICAL",
    label: "Clínico",
    description:
      "Sintomas, medicação, evolução do tratamento. Exclusivo do profissional.",
    tone: "professional",
    autoResponseEligible: false,
    alwaysEscalates: true,
    sensitive: true,
  },
  TRAINING: {
    id: "TRAINING",
    label: "Treino",
    description:
      "Execução de exercício, carga, progressão, montagem de treino.",
    tone: "professional",
    autoResponseEligible: false,
    alwaysEscalates: true,
    sensitive: false,
  },
  HEALTH_RELATED: {
    id: "HEALTH_RELATED",
    label: "Saúde",
    description:
      "Dor, lesão, restrição ou condição de saúde relatada pelo cliente.",
    tone: "warning",
    autoResponseEligible: false,
    alwaysEscalates: true,
    sensitive: true,
  },
  URGENT: {
    id: "URGENT",
    label: "Urgente",
    description: "Situação que pede resposta imediata do profissional.",
    tone: "critical",
    autoResponseEligible: false,
    alwaysEscalates: true,
    sensitive: true,
  },
  FINANCIAL: {
    id: "FINANCIAL",
    label: "Financeiro",
    description: "Cobrança, nota fiscal, reembolso, comprovante.",
    tone: "informative",
    autoResponseEligible: false,
    alwaysEscalates: false,
    sensitive: false,
  },
  POSSIBLE_RISK: {
    id: "POSSIBLE_RISK",
    label: "Possível risco",
    description:
      "Sinais que exigem atenção humana imediata. Automação é interrompida.",
    tone: "critical",
    autoResponseEligible: false,
    alwaysEscalates: true,
    sensitive: true,
  },
  UNKNOWN: {
    id: "UNKNOWN",
    label: "Não classificado",
    description:
      "O agente não reconheceu a intenção. Na dúvida, escala para o humano.",
    tone: "neutral",
    autoResponseEligible: false,
    alwaysEscalates: true,
    sensitive: false,
  },
};

export function classificationMeta(
  id: MessageClassificationId,
): MessageClassificationMeta {
  return CLASSIFICATION_META[id];
}

export function classificationLabel(
  id: MessageClassificationId | null,
): string {
  return id ? CLASSIFICATION_META[id].label : "Sem classificação";
}
