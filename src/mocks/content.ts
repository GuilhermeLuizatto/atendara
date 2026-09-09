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
    question: "Voce tem horario livre na proxima terca a tarde?",
  },
  {
    category: "LOCATION",
    question: "Qual o endereco? Tem estacionamento por perto?",
  },
  {
    category: "PAYMENT",
    question: "Consigo pagar por Pix? Precisa ser antes ou depois?",
  },
  {
    category: "CONFIRMATION",
    question: "Queria confirmar meu horario de amanha.",
  },
  {
    category: "PRICING",
    question: "O {atendimento} online tem o mesmo valor do presencial?",
  },
  { category: "SCHEDULING", question: "Voce atende no sabado de manha?" },
];

export const ADMINISTRATIVE_TEMPLATES = ADMIN_EXCHANGES.map(
  (exchange) => exchange.question,
);

export const UNKNOWN_TEMPLATES = [
  "Oi, tudo bem? Uma amiga me indicou voce. Como funciona?",
  "Voce trabalha com aquele metodo novo que vi no Instagram?",
  "Consegue me ajudar com uma coisa diferente do habitual?",
  "Posso levar meu filho junto na proxima vez?",
];

export const POSSIBLE_RISK_TEMPLATES = [
  "Nao estou bem hoje. Precisava muito falar com voce.",
  "Estou passando por um momento dificil e nao sei a quem recorrer.",
  "Nao consigo lidar com isso sozinho. Voce tem como me atender antes?",
];

/** Textos padrao por classificacao, usados quando a profissao nao especializa. */
const GENERIC_TEMPLATES: Record<MessageClassificationId, string[]> = {
  ADMINISTRATIVE: ADMINISTRATIVE_TEMPLATES,
  PROFESSIONAL: [
    "Queria sua opiniao sobre uma coisa que aconteceu esta semana.",
    "Posso te contar uma situacao e voce me diz o que acha?",
  ],
  CLINICAL: [
    "Comecei a sentir um incomodo depois da ultima vez. E normal?",
    "Posso ajustar sozinho o que combinamos na ultima consulta?",
  ],
  TRAINING: [
    "Posso trocar o agachamento por leg press hoje?",
    "Aumento a carga essa semana ou mantenho a mesma?",
  ],
  HEALTH_RELATED: [
    "Estou com dor no joelho desde ontem. Devo continuar?",
    "Apareceu um incomodo nas costas. Posso manter a rotina?",
  ],
  URGENT: [
    "Preciso muito de um horario ainda hoje, e urgente.",
    "Deu uma piora forte. Consegue me encaixar?",
  ],
  FINANCIAL: [
    "Nao recebi o recibo do mes passado, consegue reenviar?",
    "O boleto venceu ontem, como faco para regularizar?",
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
      "Queria falar sobre uma coisa que apareceu depois da ultima sessao.",
      "Tenho pensado muito no que conversamos. Posso escrever aqui?",
    ],
  },
  PSYCHIATRIST: {
    CLINICAL: [
      "Posso diminuir a dose por conta propria? Estou com sono demais.",
      "Esqueci de tomar dois dias seguidos. O que faco?",
    ],
    URGENT: [
      "A medicacao acabou e minha receita venceu. Preciso hoje.",
      "Tive uma reacao diferente. Consegue falar comigo ainda hoje?",
    ],
  },
  DOCTOR: {
    CLINICAL: [
      "Estou com febre desde ontem. Posso tomar algo por conta?",
      "Os exames chegaram. Voce ja consegue me adiantar o resultado?",
    ],
  },
  DENTIST: {
    CLINICAL: [
      "A restauracao ficou sensivel ao gelado. E esperado?",
      "Posso mastigar normal do lado que voce mexeu?",
    ],
    URGENT: [
      "Quebrou um pedaco do dente agora. Consigo um encaixe hoje?",
      "Estou com dor forte desde a madrugada.",
    ],
  },
  NUTRITIONIST: {
    CLINICAL: [
      "Posso trocar a batata doce por arroz no almoco?",
      "Se eu cortar o lanche da tarde, emagreco mais rapido?",
    ],
    HEALTH_RELATED: [
      "Comecei a passar mal depois das refeicoes. E do plano?",
      "Descobri uma intolerancia. Preciso mudar tudo?",
    ],
  },
  PHYSIOTHERAPIST: {
    CLINICAL: [
      "Posso fazer os exercicios em casa sem acompanhamento?",
      "A dor voltou depois da ultima sessao. Continuo mesmo assim?",
    ],
  },
  PERSONAL_TRAINER: {
    TRAINING: [
      "Posso trocar o treino de hoje pelo de amanha?",
      "Aumento a carga do supino essa semana?",
      "Faco cardio antes ou depois da musculacao?",
    ],
    HEALTH_RELATED: [
      "Senti um estalo no ombro no ultimo treino. Sigo normal?",
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
    "Oi! O valor do {atendimento} e {preco} e a duracao e de {duracao} minutos. Qualquer duvida, {profissional} responde por aqui.",
  SCHEDULING:
    "Temos horarios livres nesta semana. Posso reservar um deles para voce e {profissional} confirma em seguida.",
  RESCHEDULING:
    "Claro! Encontrei horarios alternativos para o seu {atendimento}. Assim que voce escolher, deixo reservado.",
  CONFIRMATION:
    "Seu {atendimento} esta confirmado. Se precisar alterar, e so me avisar por aqui.",
  LOCATION:
    "O atendimento acontece no endereco cadastrado e ha estacionamento na mesma rua. Envio o mapa se ajudar.",
  PAYMENT:
    "Aceitamos Pix, cartao e transferencia. O pagamento pode ser feito antes ou logo apos o {atendimento}.",
};

export const ESCALATION_REASONS: Record<MessageClassificationId, string> = {
  ADMINISTRATIVE: "Assunto administrativo coberto por regra ativa.",
  PROFESSIONAL: "Pedido de avaliacao tecnica: decisao e do profissional.",
  CLINICAL: "Conteudo clinico. O agente nao opina sobre conduta.",
  TRAINING: "Ajuste de treino depende de avaliacao do profissional.",
  HEALTH_RELATED: "Relato de dor ou condicao de saude. Encaminhado.",
  URGENT: "Pedido marcado como urgente pelo cliente.",
  FINANCIAL: "Pendencia financeira que exige conferencia manual.",
  POSSIBLE_RISK:
    "Possivel situacao de risco. Automacao interrompida e alerta critico gerado.",
  UNKNOWN: "Intencao nao reconhecida com confianca suficiente.",
};
