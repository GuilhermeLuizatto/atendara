import type { MessageClassificationId } from "./classification";
import type {
  AppointmentNotificationEvent,
  OutboundChannel,
} from "./notifications";

export const PROFESSION_IDS = [
  "PSYCHOLOGIST",
  "PSYCHIATRIST",
  "DOCTOR",
  "DENTIST",
  "NUTRITIONIST",
  "PHYSIOTHERAPIST",
  "THERAPIST",
  "PERSONAL_TRAINER",
] as const;

export type ProfessionId = (typeof PROFESSION_IDS)[number];

/**
 * Par de termos ja pronto para exibicao. Guardamos as quatro formas em vez de
 * capitalizar em runtime: capitalizacao automatica em pt-BR gera resultados
 * ruins ("Aluno" vs "aluno" em meio de frase) e o custo de armazenar e zero.
 */
export interface TermPair {
  singular: string;
  plural: string;
  singularLower: string;
  pluralLower: string;
  /**
   * Genero gramatical. Sem ele a interface escreve "Novo sessao": artigo e
   * adjetivo em pt-BR concordam com o termo, e o termo muda por profissao.
   */
  feminine: boolean;
}

export interface ProfessionTerminology {
  /** Como a profissao chama a pessoa atendida: paciente, aluno, cliente. */
  client: TermPair;
  /** Como chama o encontro: consulta, sessao, treino, atendimento. */
  appointment: TermPair;
  /** Como chama quem atende: psicologo, medico, personal trainer. */
  professional: TermPair;
}

export type ServiceModality = "IN_PERSON" | "ONLINE" | "HOME_VISIT" | "HYBRID";

/**
 * Grau de sensibilidade dos dados tipicamente trafegados pela profissao.
 * Controla o quanto o agente pode reter/registrar e quais avisos a interface
 * exibe. Nao substitui analise juridica.
 */
export type SensitiveDataProfile = "STANDARD" | "ELEVATED" | "HIGH";

export interface ProfessionFeatureFlags {
  /** Habilita o modulo de dados clinicos (fora do escopo do MVP). */
  clinicalRecords: boolean;
  /** Exibe campo de plano/convenio no cadastro. */
  insurancePlans: boolean;
  /** Atendimentos recorrentes por padrao (ex.: sessoes semanais, treinos). */
  recurringByDefault: boolean;
  /** Permite pacotes/planos de multiplas sessoes. */
  sessionPackages: boolean;
}

/** Semente de regra de nivel PROFESSION, aplicada ao criar a organizacao. */
export interface SuggestedRuleSeed {
  name: string;
  description: string;
  category: string;
  action: "ALLOW_TOPIC" | "DENY_TOPIC" | "ESCALATE";
  enabled: boolean;
}

/**
 * Quanto de um atendimento pode aparecer no texto que sai da clinica.
 *
 * Um lembrete de psiquiatra que diz "sua consulta psiquiatrica" revela
 * tratamento a quem ler a notificacao na tela bloqueada; o mesmo lembrete de
 * personal trainer dizendo "seu treino" nao revela nada. E por isso que isto e
 * um campo por profissao, e nao um texto unico com uma excecao no meio.
 */
export type AppointmentDisclosureLevel =
  /** Apenas horario e nome da organizacao. Nunca o tipo de atendimento. */
  | "TIME_ONLY"
  /** Acrescenta o nome de quem atende. */
  | "TIME_AND_PROFESSIONAL"
  /** Acrescenta o termo do atendimento ("treino", "sessao"). */
  | "TIME_PROFESSIONAL_AND_SERVICE";

export interface ProfessionNotificationConfig {
  /** Eventos que esta profissao pode avisar. O que nao esta aqui nao sai. */
  allowedEvents: AppointmentNotificationEvent[];
  /** Canais aceitaveis para o grau de sensibilidade da profissao. */
  allowedChannels: OutboundChannel[];
  disclosure: AppointmentDisclosureLevel;
  /** Antecedencia sugerida ao ligar um lembrete, em minutos. */
  defaultLeadMinutes: number;
  /**
   * Modelo por evento. Usa apenas as variaveis de `TEMPLATE_VARIABLES`; o
   * renderizador recusa qualquer outra e recusa vocabulario clinico.
   */
  templates: Record<AppointmentNotificationEvent, string>;
}

export interface ProfessionConfig {
  id: ProfessionId;
  label: string;
  labelPlural: string;
  description: string;
  /** Chave de cor do design system usada para diferenciar a profissao na UI. */
  accent:
    | "violet"
    | "indigo"
    | "blue"
    | "cyan"
    | "teal"
    | "emerald"
    | "amber"
    | "rose";
  terminology: ProfessionTerminology;
  defaultAppointmentDurationMinutes: number;
  defaultPriceInCents: number;
  modalities: ServiceModality[];
  /** Rotulos de classificacao habilitados para esta profissao. */
  messageClassifications: MessageClassificationId[];
  sensitiveDataProfile: SensitiveDataProfile;
  /** Aviso exibido na interface. Texto informativo, nao parecer juridico. */
  complianceNotice: string;
  suggestedRules: SuggestedRuleSeed[];
  /** Avisos de atendimento permitidos e como eles falam. */
  notifications: ProfessionNotificationConfig;
  features: ProfessionFeatureFlags;
}
