import type { DateKey } from "@/mocks/dates";
import type { Rng } from "@/mocks/random";
import type { ID, ISODateString, ProfessionConfig } from "@/types";

/** Contexto compartilhado por todos os geradores de dados ficticios. */
export interface GeneratorContext {
  rng: Rng;
  profession: ProfessionConfig;
  organizationId: ID;
  /** Data-calendario de "hoje" no fuso do produto. */
  today: DateKey;
  now: ISODateString;
}

/** Carimbo de auditoria padrao para entidades semeadas. */
export function stamp(now: ISODateString) {
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
  };
}
