import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from "@/config/app";
import {
  defaultOrganizationKind,
  defaultOrganizationSettings,
} from "@/config/organization";
import { ORGANIZATION_NAMES } from "@/mocks/names";
import type { Organization } from "@/types";

import { stamp, type GeneratorContext } from "./context";

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
    kind: defaultOrganizationKind(profession.id),
    primaryProfession: profession.id,
    professions: [profession.id],
    address: "Rua das Laranjeiras, 210 — sala 12, São Paulo",
    timezone: DEFAULT_TIMEZONE,
    locale: DEFAULT_LOCALE,
    currency: "BRL",
    plan: "TRIAL",
    ownerId,
    settings: defaultOrganizationSettings(profession),
  };
}
