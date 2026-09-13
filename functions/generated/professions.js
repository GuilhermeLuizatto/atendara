// Gerado por scripts/build-functions.mjs.
import { PROFESSION_IDS, } from "./types.js";
import { PROFESSION_DEFINITIONS } from "./profession-definitions.js";
export { PROFESSION_DEFINITIONS };
/** Profissao usada quando a organizacao ainda nao escolheu uma. */
export const DEFAULT_PROFESSION = "PSYCHOLOGIST";
export function isProfessionId(value) {
    return (typeof value === "string" &&
        PROFESSION_IDS.includes(value));
}
export function getProfession(id) {
    return PROFESSION_DEFINITIONS[id];
}
/**
 * Resolve uma profissao a partir de valor nao confiavel (querystring, campo do
 * Firestore, preferencia salva). Nunca lanca: cai no padrao.
 */
export function resolveProfession(value) {
    return PROFESSION_DEFINITIONS[isProfessionId(value) ? value : DEFAULT_PROFESSION];
}
export function listProfessions() {
    return PROFESSION_IDS.map((id) => PROFESSION_DEFINITIONS[id]);
}
export function terminologyFor(id) {
    return PROFESSION_DEFINITIONS[id].terminology;
}
export function classificationsFor(id) {
    return PROFESSION_DEFINITIONS[id].messageClassifications;
}
export function supportsClassification(id, classification) {
    return PROFESSION_DEFINITIONS[id].messageClassifications.includes(classification);
}
