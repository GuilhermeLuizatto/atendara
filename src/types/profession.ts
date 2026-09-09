import type { MessageClassificationId } from "./classification";

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
  features: ProfessionFeatureFlags;
}
