import {
  PROFESSION_IDS,
  type MessageClassificationId,
  type ProfessionConfig,
  type ProfessionId,
  type ProfessionTerminology,
} from "@/types";

import { PROFESSION_DEFINITIONS } from "./definitions";

export { PROFESSION_DEFINITIONS };

/** Profissao usada quando a organizacao ainda nao escolheu uma. */
export const DEFAULT_PROFESSION: ProfessionId = "PSYCHOLOGIST";

export function isProfessionId(value: unknown): value is ProfessionId {
  return (
    typeof value === "string" &&
    (PROFESSION_IDS as readonly string[]).includes(value)
  );
}

export function getProfession(id: ProfessionId): ProfessionConfig {
  return PROFESSION_DEFINITIONS[id];
}

/**
 * Resolve uma profissao a partir de valor nao confiavel (querystring, campo do
 * Firestore, preferencia salva). Nunca lanca: cai no padrao.
 */
export function resolveProfession(value: unknown): ProfessionConfig {
  return PROFESSION_DEFINITIONS[
    isProfessionId(value) ? value : DEFAULT_PROFESSION
  ];
}

export function listProfessions(): ProfessionConfig[] {
  return PROFESSION_IDS.map((id) => PROFESSION_DEFINITIONS[id]);
}

export function terminologyFor(id: ProfessionId): ProfessionTerminology {
  return PROFESSION_DEFINITIONS[id].terminology;
}

export function classificationsFor(
  id: ProfessionId,
): MessageClassificationId[] {
  return PROFESSION_DEFINITIONS[id].messageClassifications;
}

export function supportsClassification(
  id: ProfessionId,
  classification: MessageClassificationId,
): boolean {
  return PROFESSION_DEFINITIONS[id].messageClassifications.includes(
    classification,
  );
}
