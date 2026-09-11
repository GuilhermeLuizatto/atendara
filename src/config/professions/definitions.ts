import type { ProfessionConfig, ProfessionId, TermPair } from "@/types";

/**
 * Tabela de configuracao das profissoes.
 *
 * Este arquivo e DADO, nao logica. Adicionar uma profissao nova significa
 * acrescentar uma entrada aqui — nenhum componente, servico ou motor precisa
 * ser alterado. Se algum dia for necessario um `if (profissao === X)` fora
 * deste diretorio, o dado que falta deve virar um campo desta tabela.
 */

function term(singular: string, plural: string, feminine = false): TermPair {
  return {
    singular,
    plural,
    singularLower: singular.toLocaleLowerCase("pt-BR"),
    pluralLower: plural.toLocaleLowerCase("pt-BR"),
    feminine,
  };
}

const HEALTH_COMPLIANCE_NOTICE =
  "Profissao de saude: as conversas podem conter dados sensiveis. O agente responde apenas assuntos administrativos e nunca copia conteudo de conversa para o cadastro.";

const WELLNESS_COMPLIANCE_NOTICE =
  "O agente responde apenas assuntos administrativos. Relatos de dor, lesao ou condicao de saude sao sempre encaminhados ao profissional.";

export const PROFESSION_DEFINITIONS: Record<ProfessionId, ProfessionConfig> = {
  PSYCHOLOGIST: {
    id: "PSYCHOLOGIST",
    label: "Psicologo",
    labelPlural: "Psicologos",
    description: "Atendimento psicologico individual, casal ou grupo.",
    accent: "violet",
    terminology: {
      client: term("Paciente", "Pacientes"),
      appointment: term("Sessao", "Sessoes", true),
      professional: term("Psicologo", "Psicologos"),
    },
    defaultAppointmentDurationMinutes: 50,
    defaultPriceInCents: 18000,
    modalities: ["IN_PERSON", "ONLINE"],
    messageClassifications: [
      "ADMINISTRATIVE",
      "CLINICAL",
      "POSSIBLE_RISK",
      "UNKNOWN",
    ],
    sensitiveDataProfile: "HIGH",
    complianceNotice: HEALTH_COMPLIANCE_NOTICE,
    suggestedRules: [
      {
        name: "Nunca discutir conteudo de sessao",
        description:
          "O agente nao comenta, resume ou responde nada relacionado ao conteudo terapeutico.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar valor e duracao da sessao",
        description: "Responder preco e duracao quando o paciente perguntar.",
        category: "PRICING",
        action: "ALLOW_TOPIC",
        enabled: true,
      },
    ],
    notifications: {
      // Sem `APPOINTMENT_SCHEDULED`: o primeiro contato ainda esta sendo
      // combinado por conversa, e um aviso automatico nessa hora cria registro
      // do vinculo antes de a pessoa ter escolhido o canal.
      allowedEvents: [
        "APPOINTMENT_REMINDER",
        "APPOINTMENT_CONFIRMED",
        "APPOINTMENT_CANCELLED",
      ],
      // SMS fica de fora: chega sem remetente identificavel e sem como revogar
      // o consentimento pela propria mensagem.
      allowedChannels: ["EMAIL", "WHATSAPP"],
      disclosure: "TIME_ONLY",
      defaultLeadMinutes: 1440,
      templates: {
        APPOINTMENT_SCHEDULED:
          "Ola, {{clientName}}. Seu horario em {{organizationName}} ficou marcado para {{date}} as {{time}}.",
        APPOINTMENT_REMINDER:
          "Ola, {{clientName}}. Lembrete do seu horario em {{date}} as {{time}}. Responda esta mensagem se precisar remarcar.",
        APPOINTMENT_CONFIRMED:
          "Ola, {{clientName}}. Seu horario em {{date}} as {{time}} esta confirmado.",
        APPOINTMENT_CANCELLED:
          "Ola, {{clientName}}. Seu horario em {{date}} as {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: false,
      recurringByDefault: true,
      sessionPackages: true,
    },
  },

  PSYCHIATRIST: {
    id: "PSYCHIATRIST",
    label: "Psiquiatra",
    labelPlural: "Psiquiatras",
    description: "Consulta psiquiatrica, acompanhamento e prescricao.",
    accent: "indigo",
    terminology: {
      client: term("Paciente", "Pacientes"),
      appointment: term("Consulta", "Consultas", true),
      professional: term("Psiquiatra", "Psiquiatras"),
    },
    defaultAppointmentDurationMinutes: 40,
    defaultPriceInCents: 45000,
    modalities: ["IN_PERSON", "ONLINE"],
    messageClassifications: [
      "ADMINISTRATIVE",
      "CLINICAL",
      "URGENT",
      "POSSIBLE_RISK",
      "UNKNOWN",
    ],
    sensitiveDataProfile: "HIGH",
    complianceNotice: HEALTH_COMPLIANCE_NOTICE,
    suggestedRules: [
      {
        name: "Nunca orientar sobre medicacao",
        description:
          "Duvidas sobre dose, efeito ou troca de medicacao vao direto para o profissional.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar politica de receitas",
        description:
          "Explicar o procedimento administrativo para solicitar renovacao de receita.",
        category: "SERVICES",
        action: "ALLOW_TOPIC",
        enabled: true,
      },
    ],
    notifications: {
      // Sem `APPOINTMENT_SCHEDULED`: o primeiro contato ainda esta sendo
      // combinado por conversa, e um aviso automatico nessa hora cria registro
      // do vinculo antes de a pessoa ter escolhido o canal.
      allowedEvents: [
        "APPOINTMENT_REMINDER",
        "APPOINTMENT_CONFIRMED",
        "APPOINTMENT_CANCELLED",
      ],
      // SMS fica de fora: chega sem remetente identificavel e sem como revogar
      // o consentimento pela propria mensagem.
      allowedChannels: ["EMAIL", "WHATSAPP"],
      disclosure: "TIME_ONLY",
      defaultLeadMinutes: 1440,
      templates: {
        APPOINTMENT_SCHEDULED:
          "Ola, {{clientName}}. Seu horario em {{organizationName}} ficou marcado para {{date}} as {{time}}.",
        APPOINTMENT_REMINDER:
          "Ola, {{clientName}}. Lembrete do seu horario em {{date}} as {{time}}. Responda esta mensagem se precisar remarcar.",
        APPOINTMENT_CONFIRMED:
          "Ola, {{clientName}}. Seu horario em {{date}} as {{time}} esta confirmado.",
        APPOINTMENT_CANCELLED:
          "Ola, {{clientName}}. Seu horario em {{date}} as {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: true,
      recurringByDefault: true,
      sessionPackages: false,
    },
  },

  DOCTOR: {
    id: "DOCTOR",
    label: "Medico",
    labelPlural: "Medicos",
    description: "Consulta medica, retorno e acompanhamento clinico.",
    accent: "blue",
    terminology: {
      client: term("Paciente", "Pacientes"),
      appointment: term("Consulta", "Consultas", true),
      professional: term("Medico", "Medicos"),
    },
    defaultAppointmentDurationMinutes: 30,
    defaultPriceInCents: 40000,
    modalities: ["IN_PERSON", "ONLINE", "HOME_VISIT"],
    messageClassifications: [
      "ADMINISTRATIVE",
      "CLINICAL",
      "URGENT",
      "POSSIBLE_RISK",
      "UNKNOWN",
    ],
    sensitiveDataProfile: "HIGH",
    complianceNotice: HEALTH_COMPLIANCE_NOTICE,
    suggestedRules: [
      {
        name: "Nunca sugerir diagnostico ou conduta",
        description:
          "Qualquer relato de sintoma e encaminhado, sem opiniao do agente.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar convenios atendidos",
        description: "Responder quais convenios sao aceitos e como funciona.",
        category: "SERVICES",
        action: "ALLOW_TOPIC",
        enabled: true,
      },
    ],
    notifications: {
      // Sem `APPOINTMENT_SCHEDULED`: o primeiro contato ainda esta sendo
      // combinado por conversa, e um aviso automatico nessa hora cria registro
      // do vinculo antes de a pessoa ter escolhido o canal.
      allowedEvents: [
        "APPOINTMENT_REMINDER",
        "APPOINTMENT_CONFIRMED",
        "APPOINTMENT_CANCELLED",
      ],
      // SMS fica de fora: chega sem remetente identificavel e sem como revogar
      // o consentimento pela propria mensagem.
      allowedChannels: ["EMAIL", "WHATSAPP"],
      disclosure: "TIME_ONLY",
      defaultLeadMinutes: 1440,
      templates: {
        APPOINTMENT_SCHEDULED:
          "Ola, {{clientName}}. Seu horario em {{organizationName}} ficou marcado para {{date}} as {{time}}.",
        APPOINTMENT_REMINDER:
          "Ola, {{clientName}}. Lembrete do seu horario em {{date}} as {{time}}. Responda esta mensagem se precisar remarcar.",
        APPOINTMENT_CONFIRMED:
          "Ola, {{clientName}}. Seu horario em {{date}} as {{time}} esta confirmado.",
        APPOINTMENT_CANCELLED:
          "Ola, {{clientName}}. Seu horario em {{date}} as {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: true,
      recurringByDefault: false,
      sessionPackages: false,
    },
  },

  DENTIST: {
    id: "DENTIST",
    label: "Dentista",
    labelPlural: "Dentistas",
    description: "Consulta odontologica, procedimentos e manutencao.",
    accent: "cyan",
    terminology: {
      client: term("Paciente", "Pacientes"),
      appointment: term("Consulta", "Consultas", true),
      professional: term("Dentista", "Dentistas"),
    },
    defaultAppointmentDurationMinutes: 45,
    defaultPriceInCents: 25000,
    modalities: ["IN_PERSON"],
    messageClassifications: [
      "ADMINISTRATIVE",
      "CLINICAL",
      "URGENT",
      "POSSIBLE_RISK",
      "UNKNOWN",
    ],
    sensitiveDataProfile: "ELEVATED",
    complianceNotice: HEALTH_COMPLIANCE_NOTICE,
    suggestedRules: [
      {
        name: "Informar valor de avaliacao inicial",
        description:
          "Responder o valor da primeira avaliacao. Orcamento de procedimento nao e automatizado.",
        category: "PRICING",
        action: "ALLOW_TOPIC",
        enabled: true,
      },
      {
        name: "Encaminhar relato de dor",
        description:
          "Relato de dor ou urgencia vira alerta imediato para a equipe.",
        category: "ESCALATION",
        action: "ESCALATE",
        enabled: true,
      },
    ],
    notifications: {
      allowedEvents: [
        "APPOINTMENT_SCHEDULED",
        "APPOINTMENT_REMINDER",
        "APPOINTMENT_CONFIRMED",
        "APPOINTMENT_CANCELLED",
      ],
      allowedChannels: ["EMAIL", "SMS", "WHATSAPP"],
      disclosure: "TIME_AND_PROFESSIONAL",
      defaultLeadMinutes: 1440,
      templates: {
        APPOINTMENT_SCHEDULED:
          "Ola, {{clientName}}. Seu horario com {{professionalName}} ficou marcado para {{date}} as {{time}}.",
        APPOINTMENT_REMINDER:
          "Ola, {{clientName}}. Lembrete do seu horario com {{professionalName}} em {{date}} as {{time}}.",
        APPOINTMENT_CONFIRMED:
          "Ola, {{clientName}}. Seu horario com {{professionalName}} em {{date}} as {{time}} esta confirmado.",
        APPOINTMENT_CANCELLED:
          "Ola, {{clientName}}. Seu horario com {{professionalName}} em {{date}} as {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: true,
      recurringByDefault: false,
      sessionPackages: true,
    },
  },

  NUTRITIONIST: {
    id: "NUTRITIONIST",
    label: "Nutricionista",
    labelPlural: "Nutricionistas",
    description: "Consulta nutricional, plano alimentar e retorno.",
    accent: "emerald",
    terminology: {
      client: term("Paciente", "Pacientes"),
      appointment: term("Consulta", "Consultas", true),
      professional: term("Nutricionista", "Nutricionistas"),
    },
    defaultAppointmentDurationMinutes: 60,
    defaultPriceInCents: 22000,
    modalities: ["IN_PERSON", "ONLINE"],
    messageClassifications: [
      "ADMINISTRATIVE",
      "CLINICAL",
      "HEALTH_RELATED",
      "POSSIBLE_RISK",
      "UNKNOWN",
    ],
    sensitiveDataProfile: "ELEVATED",
    complianceNotice: HEALTH_COMPLIANCE_NOTICE,
    suggestedRules: [
      {
        name: "Nunca ajustar plano alimentar",
        description:
          "Substituicoes, quantidades e restricoes sao decisao do profissional.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar o que levar na consulta",
        description:
          "Responder exames e informacoes necessarias para o retorno.",
        category: "SERVICES",
        action: "ALLOW_TOPIC",
        enabled: true,
      },
    ],
    notifications: {
      allowedEvents: [
        "APPOINTMENT_SCHEDULED",
        "APPOINTMENT_REMINDER",
        "APPOINTMENT_CONFIRMED",
        "APPOINTMENT_CANCELLED",
      ],
      allowedChannels: ["EMAIL", "SMS", "WHATSAPP"],
      disclosure: "TIME_AND_PROFESSIONAL",
      defaultLeadMinutes: 1440,
      templates: {
        APPOINTMENT_SCHEDULED:
          "Ola, {{clientName}}. Seu horario com {{professionalName}} ficou marcado para {{date}} as {{time}}.",
        APPOINTMENT_REMINDER:
          "Ola, {{clientName}}. Lembrete do seu horario com {{professionalName}} em {{date}} as {{time}}.",
        APPOINTMENT_CONFIRMED:
          "Ola, {{clientName}}. Seu horario com {{professionalName}} em {{date}} as {{time}} esta confirmado.",
        APPOINTMENT_CANCELLED:
          "Ola, {{clientName}}. Seu horario com {{professionalName}} em {{date}} as {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: false,
      recurringByDefault: true,
      sessionPackages: true,
    },
  },

  PHYSIOTHERAPIST: {
    id: "PHYSIOTHERAPIST",
    label: "Fisioterapeuta",
    labelPlural: "Fisioterapeutas",
    description: "Sessao de fisioterapia, reabilitacao e acompanhamento.",
    accent: "teal",
    terminology: {
      client: term("Paciente", "Pacientes"),
      appointment: term("Sessao", "Sessoes", true),
      professional: term("Fisioterapeuta", "Fisioterapeutas"),
    },
    defaultAppointmentDurationMinutes: 50,
    defaultPriceInCents: 16000,
    modalities: ["IN_PERSON", "HOME_VISIT", "ONLINE"],
    messageClassifications: [
      "ADMINISTRATIVE",
      "CLINICAL",
      "HEALTH_RELATED",
      "POSSIBLE_RISK",
      "UNKNOWN",
    ],
    sensitiveDataProfile: "ELEVATED",
    complianceNotice: WELLNESS_COMPLIANCE_NOTICE,
    suggestedRules: [
      {
        name: "Nunca orientar exercicio por mensagem",
        description:
          "Duvida sobre execucao ou dor durante exercicio vai para o profissional.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar valor do pacote de sessoes",
        description: "Responder valores de sessao avulsa e pacote fechado.",
        category: "PRICING",
        action: "ALLOW_TOPIC",
        enabled: true,
      },
    ],
    notifications: {
      allowedEvents: [
        "APPOINTMENT_SCHEDULED",
        "APPOINTMENT_REMINDER",
        "APPOINTMENT_CONFIRMED",
        "APPOINTMENT_CANCELLED",
      ],
      allowedChannels: ["EMAIL", "SMS", "WHATSAPP"],
      disclosure: "TIME_AND_PROFESSIONAL",
      defaultLeadMinutes: 720,
      templates: {
        APPOINTMENT_SCHEDULED:
          "Ola, {{clientName}}. Seu horario com {{professionalName}} ficou marcado para {{date}} as {{time}}.",
        APPOINTMENT_REMINDER:
          "Ola, {{clientName}}. Lembrete do seu horario com {{professionalName}} em {{date}} as {{time}}.",
        APPOINTMENT_CONFIRMED:
          "Ola, {{clientName}}. Seu horario com {{professionalName}} em {{date}} as {{time}} esta confirmado.",
        APPOINTMENT_CANCELLED:
          "Ola, {{clientName}}. Seu horario com {{professionalName}} em {{date}} as {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: true,
      recurringByDefault: true,
      sessionPackages: true,
    },
  },

  THERAPIST: {
    id: "THERAPIST",
    label: "Terapeuta",
    labelPlural: "Terapeutas",
    description: "Sessoes de terapia integrativa e acompanhamento.",
    accent: "rose",
    terminology: {
      client: term("Cliente", "Clientes"),
      appointment: term("Sessao", "Sessoes", true),
      professional: term("Terapeuta", "Terapeutas"),
    },
    defaultAppointmentDurationMinutes: 60,
    defaultPriceInCents: 15000,
    modalities: ["IN_PERSON", "ONLINE"],
    messageClassifications: [
      "ADMINISTRATIVE",
      "PROFESSIONAL",
      "POSSIBLE_RISK",
      "UNKNOWN",
    ],
    sensitiveDataProfile: "HIGH",
    complianceNotice: WELLNESS_COMPLIANCE_NOTICE,
    suggestedRules: [
      {
        name: "Nunca discutir conteudo de sessao",
        description:
          "O agente nao comenta nada relacionado ao processo terapeutico.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar horarios disponiveis",
        description: "Responder janelas livres da agenda quando solicitado.",
        category: "SCHEDULING",
        action: "ALLOW_TOPIC",
        enabled: true,
      },
    ],
    notifications: {
      // Sem `APPOINTMENT_SCHEDULED`: o primeiro contato ainda esta sendo
      // combinado por conversa, e um aviso automatico nessa hora cria registro
      // do vinculo antes de a pessoa ter escolhido o canal.
      allowedEvents: [
        "APPOINTMENT_REMINDER",
        "APPOINTMENT_CONFIRMED",
        "APPOINTMENT_CANCELLED",
      ],
      // SMS fica de fora: chega sem remetente identificavel e sem como revogar
      // o consentimento pela propria mensagem.
      allowedChannels: ["EMAIL", "WHATSAPP"],
      disclosure: "TIME_ONLY",
      defaultLeadMinutes: 1440,
      templates: {
        APPOINTMENT_SCHEDULED:
          "Ola, {{clientName}}. Seu horario em {{organizationName}} ficou marcado para {{date}} as {{time}}.",
        APPOINTMENT_REMINDER:
          "Ola, {{clientName}}. Lembrete do seu horario em {{date}} as {{time}}. Responda esta mensagem se precisar remarcar.",
        APPOINTMENT_CONFIRMED:
          "Ola, {{clientName}}. Seu horario em {{date}} as {{time}} esta confirmado.",
        APPOINTMENT_CANCELLED:
          "Ola, {{clientName}}. Seu horario em {{date}} as {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: false,
      insurancePlans: false,
      recurringByDefault: true,
      sessionPackages: true,
    },
  },

  PERSONAL_TRAINER: {
    id: "PERSONAL_TRAINER",
    label: "Personal trainer",
    labelPlural: "Personal trainers",
    description: "Treino individual, avaliacao fisica e acompanhamento.",
    accent: "amber",
    terminology: {
      client: term("Aluno", "Alunos"),
      appointment: term("Treino", "Treinos"),
      professional: term("Personal trainer", "Personal trainers"),
    },
    defaultAppointmentDurationMinutes: 60,
    defaultPriceInCents: 12000,
    modalities: ["IN_PERSON", "HOME_VISIT", "ONLINE"],
    messageClassifications: [
      "ADMINISTRATIVE",
      "TRAINING",
      "HEALTH_RELATED",
      "POSSIBLE_RISK",
      "UNKNOWN",
    ],
    sensitiveDataProfile: "STANDARD",
    complianceNotice: WELLNESS_COMPLIANCE_NOTICE,
    suggestedRules: [
      {
        name: "Nunca prescrever treino por mensagem",
        description:
          "Carga, serie e progressao sao decisao do profissional, nunca do agente.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar planos mensais",
        description: "Responder valores de plano mensal e treino avulso.",
        category: "PRICING",
        action: "ALLOW_TOPIC",
        enabled: true,
      },
    ],
    notifications: {
      allowedEvents: [
        "APPOINTMENT_SCHEDULED",
        "APPOINTMENT_REMINDER",
        "APPOINTMENT_CONFIRMED",
        "APPOINTMENT_CANCELLED",
      ],
      allowedChannels: ["EMAIL", "SMS", "WHATSAPP"],
      // Nada aqui revela condicao de saude, entao o texto pode nomear o
      // atendimento — e um lembrete que diz "treino" e mais util.
      disclosure: "TIME_PROFESSIONAL_AND_SERVICE",
      defaultLeadMinutes: 180,
      templates: {
        APPOINTMENT_SCHEDULED:
          "Ola, {{clientName}}. Seu {{serviceTerm}} com {{professionalName}} ficou marcado para {{date}} as {{time}}.",
        APPOINTMENT_REMINDER:
          "Ola, {{clientName}}. Lembrete do seu {{serviceTerm}} com {{professionalName}} em {{date}} as {{time}}.",
        APPOINTMENT_CONFIRMED:
          "Ola, {{clientName}}. Seu {{serviceTerm}} com {{professionalName}} em {{date}} as {{time}} esta confirmado.",
        APPOINTMENT_CANCELLED:
          "Ola, {{clientName}}. Seu {{serviceTerm}} com {{professionalName}} em {{date}} as {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: false,
      insurancePlans: false,
      recurringByDefault: true,
      sessionPackages: true,
    },
  },
};
