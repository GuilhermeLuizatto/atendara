import {
  AI_ASSISTANT_NAME,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_TIMEZONE,
} from "@/config/app";
import { ORGANIZATION_NAMES } from "@/mocks/names";
import type { Organization, OrganizationKind } from "@/types";

import { stamp, type GeneratorContext } from "./context";

/**
 * Tipo de organizacao por profissao. Demonstra que o mesmo modelo atende
 * autonomo, clinica, consultorio e estudio sem estrutura de dados diferente.
 */
const ORGANIZATION_KINDS: Record<string, OrganizationKind> = {
  PSYCHOLOGIST: "SOLO_PRACTITIONER",
  PSYCHIATRIST: "OFFICE",
  DOCTOR: "CLINIC",
  DENTIST: "CLINIC",
  NUTRITIONIST: "OFFICE",
  PHYSIOTHERAPIST: "STUDIO",
  THERAPIST: "SOLO_PRACTITIONER",
  PERSONAL_TRAINER: "GYM",
};

export function buildOrganization(
  ctx: GeneratorContext,
  ownerId: string,
): Organization {
  const { profession, organizationId, now } = ctx;

  return {
    id: organizationId,
    ...stamp(now),
    name: ORGANIZATION_NAMES[profession.id],
    slug: organizationId,
    kind: ORGANIZATION_KINDS[profession.id] ?? "SOLO_PRACTITIONER",
    primaryProfession: profession.id,
    professions: [profession.id],
    address: "Rua das Laranjeiras, 210 — sala 12, Sao Paulo",
    timezone: DEFAULT_TIMEZONE,
    locale: "pt-BR",
    currency: "BRL",
    plan: "TRIAL",
    ownerId,
    settings: {
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
        allowAutonomousReplies: true,
        quietHoursStart: "21:00",
        quietHoursEnd: "07:00",
      },
      privacy: {
        messageRetentionDays: 365,
        auditRetentionDays: 730,
        blockConversationToCrmCopy: true,
      },
    },
  };
}
