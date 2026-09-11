import type {
  ID,
  ISODateString,
  Organization,
  OrganizationKind,
  OrganizationSettings,
  ProfessionConfig,
  ProfessionId,
} from "@/types";

import { DEFAULT_NOTIFICATION_SETTINGS } from "./notifications";
import {
  AI_ASSISTANT_NAME,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
} from "./app";
import { getProfession } from "./professions";

/**
 * Configuracao inicial de uma organizacao — politica do produto, como DADO.
 *
 * O backend cria a organizacao com o minimo que conhece no momento do cadastro
 * (nome, profissao, dono). Todo o resto vem daqui, na leitura: assim uma
 * organizacao criada antes de um campo novo existir continua valida, sem
 * migracao de dados e sem `undefined` chegando na interface.
 *
 * Arquivo de dominio: nao importa `firebase/*`.
 */

/**
 * Formato tipico por profissao. E so um padrao inicial — a organizacao pode ser
 * alterada depois; nenhum comportamento do nucleo depende deste valor.
 */
const DEFAULT_KIND: Record<ProfessionId, OrganizationKind> = {
  PSYCHOLOGIST: "SOLO_PRACTITIONER",
  PSYCHIATRIST: "OFFICE",
  DOCTOR: "CLINIC",
  DENTIST: "CLINIC",
  NUTRITIONIST: "OFFICE",
  PHYSIOTHERAPIST: "STUDIO",
  THERAPIST: "SOLO_PRACTITIONER",
  PERSONAL_TRAINER: "GYM",
};

export function defaultOrganizationKind(id: ProfessionId): OrganizationKind {
  return DEFAULT_KIND[id] ?? "SOLO_PRACTITIONER";
}

/** Intervalos oferecidos na grade da agenda, em minutos. */
export const AGENDA_SLOT_INTERVALS = [10, 15, 20, 30, 45, 60] as const;

export function defaultOrganizationSettings(
  profession: ProfessionConfig,
): OrganizationSettings {
  return {
    agenda: {
      workingDays: [1, 2, 3, 4, 5],
      workdayStart: "08:00",
      workdayEnd: "19:00",
      slotIntervalMinutes: 30,
      defaultModality: profession.modalities[0],
      allowDoubleBooking: false,
    },
    ai: {
      enabled: true,
      displayName: AI_ASSISTANT_NAME,
      autoResponseConfidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
      // O agente comeca podendo responder sozinho apenas o que a taxonomia
      // marca como administrativo; a trava real esta em CLASSIFICATION_META.
      allowAutonomousReplies: true,
      quietHoursStart: "21:00",
      quietHoursEnd: "07:00",
    },
    privacy: {
      messageRetentionDays: 365,
      auditRetentionDays: 730,
      blockConversationToCrmCopy: true,
    },
    // Avisos ao cliente nascem desligados, sem canal e sem regra. O padrao nao
    // e cautela de interface: e a unica coisa que impede uma organizacao recem
    // criada de mandar mensagem para quem nunca consentiu.
    //
    // Copiado, e nao referenciado: o padrao carrega arrays, e devolver a mesma
    // instancia faria a configuracao de uma organizacao aparecer em outra.
    notifications: {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      verifiedSenderChannels: [],
      rules: [],
    },
  };
}

/** Documento cru da organizacao, como o backend pode te-lo gravado. */
export interface PartialOrganization {
  id?: ID;
  name?: string;
  slug?: string;
  kind?: OrganizationKind;
  primaryProfession?: ProfessionId;
  professions?: ProfessionId[];
  address?: string | null;
  timezone?: string;
  locale?: string;
  currency?: Organization["currency"];
  plan?: Organization["plan"];
  ownerId?: ID;
  settings?: Partial<OrganizationSettings>;
  createdAt?: ISODateString | null;
  updatedAt?: ISODateString | null;
  createdBy?: ID | null;
  updatedBy?: ID | null;
}

/**
 * Completa um documento parcial ate um `Organization` valido.
 *
 * `professionId` vem da conta do usuario e serve de fallback quando o documento
 * ainda nao declara a profissao — nunca sobrepoe o que esta gravado, porque e o
 * documento que as Security Rules conferem contra a conta.
 */
export function withOrganizationDefaults(
  raw: PartialOrganization,
  organizationId: ID,
  professionId: ProfessionId,
  now: ISODateString,
): Organization {
  const primaryProfession = raw.primaryProfession ?? professionId;
  const profession = getProfession(primaryProfession);
  const defaults = defaultOrganizationSettings(profession);
  const createdAt = raw.createdAt ?? now;

  return {
    id: organizationId,
    createdAt,
    updatedAt: raw.updatedAt ?? createdAt,
    createdBy: raw.createdBy ?? null,
    updatedBy: raw.updatedBy ?? null,
    name: raw.name ?? profession.label,
    slug: raw.slug ?? organizationId,
    kind: raw.kind ?? defaultOrganizationKind(primaryProfession),
    primaryProfession,
    professions: raw.professions ?? [primaryProfession],
    address: raw.address ?? null,
    timezone: raw.timezone ?? DEFAULT_TIMEZONE,
    locale: raw.locale ?? DEFAULT_LOCALE,
    currency: raw.currency ?? "BRL",
    plan: raw.plan ?? "TRIAL",
    ownerId: raw.ownerId ?? "",
    settings: {
      agenda: { ...defaults.agenda, ...raw.settings?.agenda },
      ai: { ...defaults.ai, ...raw.settings?.ai },
      privacy: { ...defaults.privacy, ...raw.settings?.privacy },
      notifications: {
        ...defaults.notifications,
        ...raw.settings?.notifications,
      },
    },
  };
}
