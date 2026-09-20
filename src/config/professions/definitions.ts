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
  "Profissão de saúde: as conversas podem conter dados sensíveis. O agente responde apenas assuntos administrativos e nunca copia conteúdo de conversa para o cadastro.";

const WELLNESS_COMPLIANCE_NOTICE =
  "O agente responde apenas assuntos administrativos. Relatos de dor, lesão ou condição de saúde são sempre encaminhados ao profissional.";

export const PROFESSION_DEFINITIONS: Record<ProfessionId, ProfessionConfig> = {
  PSYCHOLOGIST: {
    id: "PSYCHOLOGIST",
    label: "Psicólogo",
    labelPlural: "Psicólogos",
    listed: true,
    council: { acronym: "CRP", name: "Conselho Regional de Psicologia" },
    description: "Atendimento psicológico individual, casal ou grupo.",
    accent: "violet",
    terminology: {
      client: term("Paciente", "Pacientes"),
      appointment: term("Sessão", "Sessões", true),
      professional: term("Psicólogo", "Psicólogos"),
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
        name: "Nunca discutir conteúdo de sessão",
        description:
          "O agente não comenta, resume ou responde nada relacionado ao conteúdo terapêutico.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar valor e duração da sessão",
        description: "Responder preço e duração quando o paciente perguntar.",
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
          "Olá, {{clientName}}. Seu horário em {{organizationName}} ficou marcado para {{date}} às {{time}}.",
        APPOINTMENT_REMINDER:
          "Olá, {{clientName}}. Lembrete do seu horário em {{date}} às {{time}}. Responda esta mensagem se precisar remarcar.",
        APPOINTMENT_CONFIRMED:
          "Olá, {{clientName}}. Seu horário em {{date}} às {{time}} está confirmado.",
        APPOINTMENT_CANCELLED:
          "Olá, {{clientName}}. Seu horário em {{date}} às {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: false,
      recurringByDefault: true,
      sessionPackages: true,
      serviceCatalog: false,
      depositOnBooking: false,
      homeVisitDetails: false,
    },
  },

  PSYCHIATRIST: {
    id: "PSYCHIATRIST",
    label: "Psiquiatra",
    labelPlural: "Psiquiatras",
    listed: true,
    council: { acronym: "CRM", name: "Conselho Regional de Medicina" },
    description: "Consulta psiquiátrica, acompanhamento e prescrição.",
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
        name: "Nunca orientar sobre medicação",
        description:
          "Dúvidas sobre dose, efeito ou troca de medicação vão direto para o profissional.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar política de receitas",
        description:
          "Explicar o procedimento administrativo para solicitar renovação de receita.",
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
          "Olá, {{clientName}}. Seu horário em {{organizationName}} ficou marcado para {{date}} às {{time}}.",
        APPOINTMENT_REMINDER:
          "Olá, {{clientName}}. Lembrete do seu horário em {{date}} às {{time}}. Responda esta mensagem se precisar remarcar.",
        APPOINTMENT_CONFIRMED:
          "Olá, {{clientName}}. Seu horário em {{date}} às {{time}} está confirmado.",
        APPOINTMENT_CANCELLED:
          "Olá, {{clientName}}. Seu horário em {{date}} às {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: true,
      recurringByDefault: true,
      sessionPackages: false,
      serviceCatalog: false,
      depositOnBooking: false,
      homeVisitDetails: false,
    },
  },

  DOCTOR: {
    id: "DOCTOR",
    label: "Médico",
    labelPlural: "Médicos",
    listed: true,
    council: { acronym: "CRM", name: "Conselho Regional de Medicina" },
    description: "Consulta médica, retorno e acompanhamento clínico.",
    accent: "blue",
    terminology: {
      client: term("Paciente", "Pacientes"),
      appointment: term("Consulta", "Consultas", true),
      professional: term("Médico", "Médicos"),
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
        name: "Nunca sugerir diagnóstico ou conduta",
        description:
          "Qualquer relato de sintoma é encaminhado, sem opinião do agente.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar convênios atendidos",
        description: "Responder quais convênios são aceitos e como funciona.",
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
          "Olá, {{clientName}}. Seu horário em {{organizationName}} ficou marcado para {{date}} às {{time}}.",
        APPOINTMENT_REMINDER:
          "Olá, {{clientName}}. Lembrete do seu horário em {{date}} às {{time}}. Responda esta mensagem se precisar remarcar.",
        APPOINTMENT_CONFIRMED:
          "Olá, {{clientName}}. Seu horário em {{date}} às {{time}} está confirmado.",
        APPOINTMENT_CANCELLED:
          "Olá, {{clientName}}. Seu horário em {{date}} às {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: true,
      recurringByDefault: false,
      sessionPackages: false,
      serviceCatalog: false,
      depositOnBooking: false,
      homeVisitDetails: false,
    },
  },

  DENTIST: {
    id: "DENTIST",
    label: "Dentista",
    labelPlural: "Dentistas",
    listed: true,
    council: { acronym: "CRO", name: "Conselho Regional de Odontologia" },
    description: "Consulta odontológica, procedimentos e manutenção.",
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
        name: "Informar valor de avaliação inicial",
        description:
          "Responder o valor da primeira avaliação. Orçamento de procedimento não é automatizado.",
        category: "PRICING",
        action: "ALLOW_TOPIC",
        enabled: true,
      },
      {
        name: "Encaminhar relato de dor",
        description:
          "Relato de dor ou urgência vira alerta imediato para a equipe.",
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
          "Olá, {{clientName}}. Seu horário com {{professionalName}} ficou marcado para {{date}} às {{time}}.",
        APPOINTMENT_REMINDER:
          "Olá, {{clientName}}. Lembrete do seu horário com {{professionalName}} em {{date}} às {{time}}.",
        APPOINTMENT_CONFIRMED:
          "Olá, {{clientName}}. Seu horário com {{professionalName}} em {{date}} às {{time}} está confirmado.",
        APPOINTMENT_CANCELLED:
          "Olá, {{clientName}}. Seu horário com {{professionalName}} em {{date}} às {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: true,
      recurringByDefault: false,
      sessionPackages: true,
      serviceCatalog: false,
      depositOnBooking: false,
      homeVisitDetails: false,
    },
  },

  NUTRITIONIST: {
    id: "NUTRITIONIST",
    label: "Nutricionista",
    labelPlural: "Nutricionistas",
    listed: true,
    council: { acronym: "CRN", name: "Conselho Regional de Nutricionistas" },
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
          "Substituições, quantidades e restrições são decisão do profissional.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar o que levar na consulta",
        description:
          "Responder exames e informações necessárias para o retorno.",
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
          "Olá, {{clientName}}. Seu horário com {{professionalName}} ficou marcado para {{date}} às {{time}}.",
        APPOINTMENT_REMINDER:
          "Olá, {{clientName}}. Lembrete do seu horário com {{professionalName}} em {{date}} às {{time}}.",
        APPOINTMENT_CONFIRMED:
          "Olá, {{clientName}}. Seu horário com {{professionalName}} em {{date}} às {{time}} está confirmado.",
        APPOINTMENT_CANCELLED:
          "Olá, {{clientName}}. Seu horário com {{professionalName}} em {{date}} às {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: false,
      recurringByDefault: true,
      sessionPackages: true,
      serviceCatalog: false,
      depositOnBooking: false,
      homeVisitDetails: false,
    },
  },

  PHYSIOTHERAPIST: {
    id: "PHYSIOTHERAPIST",
    label: "Fisioterapeuta",
    labelPlural: "Fisioterapeutas",
    listed: true,
    council: { acronym: "CREFITO", name: "Conselho Regional de Fisioterapia e Terapia Ocupacional" },
    description: "Sessão de fisioterapia, reabilitação e acompanhamento.",
    accent: "teal",
    terminology: {
      client: term("Paciente", "Pacientes"),
      appointment: term("Sessão", "Sessões", true),
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
        name: "Nunca orientar exercício por mensagem",
        description:
          "Dúvida sobre execução ou dor durante exercício vai para o profissional.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar valor do pacote de sessões",
        description: "Responder valores de sessão avulsa e pacote fechado.",
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
          "Olá, {{clientName}}. Seu horário com {{professionalName}} ficou marcado para {{date}} às {{time}}.",
        APPOINTMENT_REMINDER:
          "Olá, {{clientName}}. Lembrete do seu horário com {{professionalName}} em {{date}} às {{time}}.",
        APPOINTMENT_CONFIRMED:
          "Olá, {{clientName}}. Seu horário com {{professionalName}} em {{date}} às {{time}} está confirmado.",
        APPOINTMENT_CANCELLED:
          "Olá, {{clientName}}. Seu horário com {{professionalName}} em {{date}} às {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: true,
      insurancePlans: true,
      recurringByDefault: true,
      sessionPackages: true,
      serviceCatalog: false,
      depositOnBooking: false,
      homeVisitDetails: false,
    },
  },

  THERAPIST: {
    id: "THERAPIST",
    label: "Terapeuta",
    labelPlural: "Terapeutas",
    // Escondida das listas por decisao do titular em 16/09/2026: nao ha
    // publico para ela agora. A entrada continua aqui para as contas que ja
    // existam e para os testes continuarem cobrindo a profissao.
    listed: false,
    // Profissao sem conselho de classe: o cadastro nao pede registro.
    council: null,
    description: "Sessões de terapia integrativa e acompanhamento.",
    accent: "rose",
    terminology: {
      client: term("Cliente", "Clientes"),
      appointment: term("Sessão", "Sessões", true),
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
        name: "Nunca discutir conteúdo de sessão",
        description:
          "O agente não comenta nada relacionado ao processo terapêutico.",
        category: "SAFETY",
        action: "DENY_TOPIC",
        enabled: true,
      },
      {
        name: "Informar horários disponíveis",
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
          "Olá, {{clientName}}. Seu horário em {{organizationName}} ficou marcado para {{date}} às {{time}}.",
        APPOINTMENT_REMINDER:
          "Olá, {{clientName}}. Lembrete do seu horário em {{date}} às {{time}}. Responda esta mensagem se precisar remarcar.",
        APPOINTMENT_CONFIRMED:
          "Olá, {{clientName}}. Seu horário em {{date}} às {{time}} está confirmado.",
        APPOINTMENT_CANCELLED:
          "Olá, {{clientName}}. Seu horário em {{date}} às {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: false,
      insurancePlans: false,
      recurringByDefault: true,
      sessionPackages: true,
      serviceCatalog: false,
      depositOnBooking: false,
      homeVisitDetails: false,
    },
  },

  PERSONAL_TRAINER: {
    id: "PERSONAL_TRAINER",
    label: "Personal trainer",
    labelPlural: "Personal trainers",
    listed: true,
    council: { acronym: "CREF", name: "Conselho Regional de Educação Física" },
    description: "Treino individual, avaliação física e acompanhamento.",
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
          "Carga, série e progressão são decisão do profissional, nunca do agente.",
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
          "Olá, {{clientName}}. Seu {{serviceTerm}} com {{professionalName}} ficou marcado para {{date}} às {{time}}.",
        APPOINTMENT_REMINDER:
          "Olá, {{clientName}}. Lembrete do seu {{serviceTerm}} com {{professionalName}} em {{date}} às {{time}}.",
        APPOINTMENT_CONFIRMED:
          "Olá, {{clientName}}. Seu {{serviceTerm}} com {{professionalName}} em {{date}} às {{time}} está confirmado.",
        APPOINTMENT_CANCELLED:
          "Olá, {{clientName}}. Seu {{serviceTerm}} com {{professionalName}} em {{date}} às {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: false,
      insurancePlans: false,
      recurringByDefault: true,
      sessionPackages: true,
      serviceCatalog: false,
      depositOnBooking: false,
      homeVisitDetails: false,
    },
  },

  AESTHETICS: {
    id: "AESTHETICS",
    label: "Estética",
    labelPlural: "Estética",
    listed: true,
    // Profissao sem conselho de classe: o cadastro nao pede registro.
    council: null,
    description:
      "Manicure e pedicure, sobrancelha, cílios, depilação e maquiagem.",
    accent: "fuchsia",
    terminology: {
      client: term("Cliente", "Clientes"),
      appointment: term("Atendimento", "Atendimentos"),
      professional: term("Esteticista", "Esteticistas"),
    },
    // Preco e duracao dependem do servico, e quem define e a profissional.
    defaultAppointmentDurationMinutes: null,
    defaultPriceInCents: null,
    modalities: ["IN_PERSON", "HOME_VISIT"],
    messageClassifications: [
      "ADMINISTRATIVE",
      "PROFESSIONAL",
      "HEALTH_RELATED",
      "POSSIBLE_RISK",
      "UNKNOWN",
    ],
    // Depilacao, pele e unha encostam em saude: reacao e machucado aparecem na
    // conversa, entao o perfil acompanha o das profissoes de dado elevado.
    sensitiveDataProfile: "ELEVATED",
    complianceNotice: WELLNESS_COMPLIANCE_NOTICE,
    suggestedRules: [
      {
        name: "Encaminhar relato de reação ou machucado",
        description:
          "Alergia, irritação, inflamação ou corte depois do atendimento vira alerta para a profissional.",
        category: "ESCALATION",
        action: "ESCALATE",
        enabled: true,
      },
      {
        name: "Informar horários disponíveis",
        description: "Responder janelas livres da agenda quando solicitado.",
        category: "SCHEDULING",
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
      // Sem o nome do servico: "sua depilacao" na tela bloqueada diz mais do
      // que o horario precisa dizer.
      disclosure: "TIME_AND_PROFESSIONAL",
      defaultLeadMinutes: 1440,
      templates: {
        APPOINTMENT_SCHEDULED:
          "Olá, {{clientName}}. Seu horário com {{professionalName}} ficou marcado para {{date}} às {{time}}.",
        APPOINTMENT_REMINDER:
          "Olá, {{clientName}}. Lembrete do seu horário com {{professionalName}} em {{date}} às {{time}}.",
        APPOINTMENT_CONFIRMED:
          "Olá, {{clientName}}. Seu horário com {{professionalName}} em {{date}} às {{time}} está confirmado.",
        APPOINTMENT_CANCELLED:
          "Olá, {{clientName}}. Seu horário com {{professionalName}} em {{date}} às {{time}} foi cancelado. Responda para remarcar.",
      },
    },
    features: {
      clinicalRecords: false,
      insurancePlans: false,
      recurringByDefault: false,
      sessionPackages: false,
      serviceCatalog: true,
      depositOnBooking: true,
      homeVisitDetails: true,
    },
  },
};
