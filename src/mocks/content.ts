import type { MessageClassificationId, ProfessionId } from "@/types";

/**
 * Textos de demonstracao.
 *
 * Os placeholders `{atendimento}` e `{cliente}` sao substituidos pela
 * terminologia da profissao ativa — e assim que a mesma mensagem aparece como
 * "remarcar minha sessao" para o psicologo e "remarcar meu treino" para o
 * personal trainer, sem duplicar conteudo.
 */

/**
 * Perguntas administrativas pareadas com a categoria de regra que as autoriza.
 * O par mantem pergunta e resposta coerentes na demonstracao e permite que a
 * decisao da IA cite a regra correta.
 */
export interface AdminExchange {
  category: keyof typeof AGENT_REPLIES;
  question: string;
}

export const ADMIN_EXCHANGES: AdminExchange[] = [
  {
    category: "RESCHEDULING",
    question: "Oi! Consigo remarcar meu {atendimento} desta semana?",
  },
  { category: "PRICING", question: "Bom dia, qual o valor do {atendimento}?" },
  {
    category: "SCHEDULING",
    question: "Você tem horário livre na próxima terça à tarde?",
  },
  {
    category: "LOCATION",
    question: "Qual o endereço? Tem estacionamento por perto?",
  },
  {
    category: "PAYMENT",
    question: "Consigo pagar por Pix? Precisa ser antes ou depois?",
  },
  {
    category: "CONFIRMATION",
    question: "Queria confirmar meu horário de amanhã.",
  },
  {
    category: "PRICING",
    question: "O {atendimento} online tem o mesmo valor do presencial?",
  },
  { category: "SCHEDULING", question: "Você atende no sábado de manhã?" },
];

export const ADMINISTRATIVE_TEMPLATES = ADMIN_EXCHANGES.map(
  (exchange) => exchange.question,
);

export const UNKNOWN_TEMPLATES = [
  "Oi, tudo bem? Uma amiga me indicou você. Como funciona?",
  "Você trabalha com aquele método novo que vi no Instagram?",
  "Consegue me ajudar com uma coisa diferente do habitual?",
  "Posso levar meu filho junto na próxima vez?",
];

export const POSSIBLE_RISK_TEMPLATES = [
  "Não estou bem hoje. Precisava muito falar com você.",
  "Estou passando por um momento difícil e não sei a quem recorrer.",
  "Não consigo lidar com isso sozinho. Você tem como me atender antes?",
];

/** Textos padrao por classificacao, usados quando a profissao nao especializa. */
const GENERIC_TEMPLATES: Record<MessageClassificationId, string[]> = {
  ADMINISTRATIVE: ADMINISTRATIVE_TEMPLATES,
  PROFESSIONAL: [
    "Queria sua opinião sobre uma coisa que aconteceu esta semana.",
    "Posso te contar uma situação e você me diz o que acha?",
  ],
  CLINICAL: [
    "Comecei a sentir um incômodo depois da última vez. É normal?",
    "Posso ajustar sozinho o que combinamos na última consulta?",
  ],
  TRAINING: [
    "Posso trocar o agachamento por leg press hoje?",
    "Aumento a carga essa semana ou mantenho a mesma?",
  ],
  HEALTH_RELATED: [
    "Estou com dor no joelho desde ontem. Devo continuar?",
    "Apareceu um incômodo nas costas. Posso manter a rotina?",
  ],
  URGENT: [
    "Preciso muito de um horário ainda hoje, é urgente.",
    "Deu uma piora forte. Consegue me encaixar?",
  ],
  FINANCIAL: [
    "Não recebi o recibo do mês passado, consegue reenviar?",
    "O boleto venceu ontem, como faço para regularizar?",
  ],
  POSSIBLE_RISK: POSSIBLE_RISK_TEMPLATES,
  UNKNOWN: UNKNOWN_TEMPLATES,
};

/** Especializacoes por profissao. Sobrepoem o texto generico quando existem. */
const PROFESSION_FLAVOR: Partial<
  Record<ProfessionId, Partial<Record<MessageClassificationId, string[]>>>
> = {
  PSYCHOLOGIST: {
    CLINICAL: [
      "Queria falar sobre uma coisa que apareceu depois da última sessão.",
      "Tenho pensado muito no que conversamos. Posso escrever aqui?",
    ],
  },
  PSYCHIATRIST: {
    CLINICAL: [
      "Posso diminuir a dose por conta própria? Estou com sono demais.",
      "Esqueci de tomar dois dias seguidos. O que faço?",
    ],
    URGENT: [
      "A medicação acabou e minha receita venceu. Preciso hoje.",
      "Tive uma reação diferente. Consegue falar comigo ainda hoje?",
    ],
  },
  DOCTOR: {
    CLINICAL: [
      "Estou com febre desde ontem. Posso tomar algo por conta?",
      "Os exames chegaram. Você já consegue me adiantar o resultado?",
    ],
  },
  DENTIST: {
    CLINICAL: [
      "A restauração ficou sensível ao gelado. É esperado?",
      "Posso mastigar normal do lado que você mexeu?",
    ],
    URGENT: [
      "Quebrou um pedaço do dente agora. Consigo um encaixe hoje?",
      "Estou com dor forte desde a madrugada.",
    ],
  },
  NUTRITIONIST: {
    CLINICAL: [
      "Posso trocar a batata doce por arroz no almoço?",
      "Se eu cortar o lanche da tarde, emagreço mais rápido?",
    ],
    HEALTH_RELATED: [
      "Comecei a passar mal depois das refeições. É do plano?",
      "Descobri uma intolerância. Preciso mudar tudo?",
    ],
  },
  PHYSIOTHERAPIST: {
    CLINICAL: [
      "Posso fazer os exercícios em casa sem acompanhamento?",
      "A dor voltou depois da última sessão. Continuo mesmo assim?",
    ],
  },
  PERSONAL_TRAINER: {
    TRAINING: [
      "Posso trocar o treino de hoje pelo de amanhã?",
      "Aumento a carga do supino essa semana?",
      "Faço cardio antes ou depois da musculação?",
    ],
    HEALTH_RELATED: [
      "Senti um estalo no ombro no último treino. Sigo normal?",
      "Estou com dor lombar desde ontem. Posso treinar hoje?",
    ],
  },
};

export function templatesFor(
  profession: ProfessionId,
  classification: MessageClassificationId,
): string[] {
  return (
    PROFESSION_FLAVOR[profession]?.[classification] ??
    GENERIC_TEMPLATES[classification]
  );
}

/**
 * Respostas automaticas do agente para assuntos administrativos.
 * Sem anotacao de tipo de proposito: as chaves literais viram a uniao usada por
 * `AdminExchange.category`.
 */
export const AGENT_REPLIES = {
  PRICING:
    "Oi! O valor do {atendimento} é {preco} e a duração é de {duracao} minutos. Qualquer dúvida, {profissional} responde por aqui.",
  SCHEDULING:
    "Temos horários livres nesta semana. Posso reservar um deles para você e {profissional} confirma em seguida.",
  RESCHEDULING:
    "Claro! Encontrei horários alternativos para o seu {atendimento}. Assim que você escolher, deixo reservado.",
  CONFIRMATION:
    "Seu {atendimento} está confirmado. Se precisar alterar, é só me avisar por aqui.",
  LOCATION:
    "O atendimento acontece no endereço cadastrado e há estacionamento na mesma rua. Envio o mapa se ajudar.",
  PAYMENT:
    "Aceitamos Pix, cartão e transferência. O pagamento pode ser feito antes ou logo após o {atendimento}.",
};

export const ESCALATION_REASONS: Record<MessageClassificationId, string> = {
  ADMINISTRATIVE: "Assunto administrativo coberto por regra ativa.",
  PROFESSIONAL: "Pedido de avaliação técnica: decisão é do profissional.",
  CLINICAL: "Conteúdo clínico. O agente não opina sobre conduta.",
  TRAINING: "Ajuste de treino depende de avaliação do profissional.",
  HEALTH_RELATED: "Relato de dor ou condição de saúde. Encaminhado.",
  URGENT: "Pedido marcado como urgente pelo cliente.",
  FINANCIAL: "Pendência financeira que exige conferência manual.",
  POSSIBLE_RISK:
    "Possível situação de risco. Automação interrompida e alerta crítico gerado.",
  UNKNOWN: "Intenção não reconhecida com confiança suficiente.",
};
