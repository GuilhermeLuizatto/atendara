import type { ProfessionId } from "@/types";

import { MemoryWorkspaceRepository } from "./memory/memory-repository";
import type { WorkspaceRepository } from "./types";

export * from "./types";
export { MemoryWorkspaceRepository };

/**
 * Fabrica do repositorio.
 *
 * Hoje entrega sempre a implementacao em memoria. Na etapa de Firebase real,
 * este e o unico ponto que decide entre memoria e Firestore — nenhuma tela
 * conhece a diferenca.
 */
export function createWorkspaceRepository(
  professionId: ProfessionId,
  anchor: Date = new Date(),
  scope?: string,
): WorkspaceRepository {
  return new MemoryWorkspaceRepository(professionId, anchor, scope);
}
