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

/**
 * As profissoes oferecidas hoje, na ordem da tabela. E esta a lista que vai a
 * tela — cadastro, administracao e demonstracao.
 */
export function listProfessions(): ProfessionConfig[] {
  return listAllProfessions().filter((profession) => profession.listed);
}

/**
 * Todas, inclusive as escondidas. Serve a quem precisa da tabela inteira:
 * os testes que conferem invariantes de todas as profissoes e qualquer leitura
 * de conta que ja tenha uma profissao fora da vitrine.
 */
export function listAllProfessions(): ProfessionConfig[] {
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
