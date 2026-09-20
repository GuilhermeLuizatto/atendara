import { AESTHETICS_SERVICE_SEEDS } from "./generated/services-config.js";
import { paths } from "./generated/paths.js";
import { getProfession } from "./generated/professions.js";

/**
 * Catalogo inicial da organizacao (E2.1).
 *
 * So nasce para profissao com `features.serviceCatalog` — a flag decide, nunca
 * o nome da profissao (regra 1). As sugestoes entram **sem preco e
 * desligadas**: o Atendara nao sugere valor, e servico desligado nao aparece na
 * hora de agendar. Quem cobra escolhe quanto cobra.
 *
 * O cliente nao consegue criar isto no primeiro acesso da conta pessoal: as
 * regras exigem papel administrativo. Por isso nasce junto do resto, no mesmo
 * lote do cadastro.
 */
export function seedServices(batch, { db, organizationId, professionId, stamp }) {
  if (!getProfession(professionId)?.features?.serviceCatalog) return 0;

  AESTHETICS_SERVICE_SEEDS.forEach((seed, index) => {
    const id = `servico-${index + 1}`;
    batch.create(db.doc(paths.document(organizationId, "services", id)), {
      id,
      organizationId,
      ...seed,
      position: index,
      archivedAt: null,
      ...stamp,
    });
  });

  return AESTHETICS_SERVICE_SEEDS.length;
}
