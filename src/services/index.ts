import { getDb } from "@/lib/firebase/client";
import { isDemoMode } from "@/lib/firebase/config";
import type { ID, ProfessionId } from "@/types";

import { FirestoreWorkspaceRepository } from "./firestore/firestore-repository";
import { MemoryWorkspaceRepository } from "./memory/memory-repository";
import type { WorkspaceRepository } from "./types";

export * from "./types";
export { MemoryWorkspaceRepository, FirestoreWorkspaceRepository };

export interface WorkspaceRepositoryOptions {
  professionId: ProfessionId;
  /**
   * Organizacao real do usuario. `null` para o administrador da plataforma,
   * que nao atende ninguem e portanto nao possui tenant operacional.
   */
  organizationId?: ID | null;
  /** Quem usa o painel. No Firestore, e dele o vinculo lido para o papel. */
  userId?: ID | null;
  /** Ancora temporal do conjunto demonstrativo. Ignorada no Firestore. */
  anchor?: Date;
  /** Escopo do armazenamento local da demonstracao. Ignorado no Firestore. */
  scope?: string;
}

/**
 * Fabrica do repositorio — o unico ponto que decide entre memoria e Firestore.
 * Nenhuma tela conhece a diferenca.
 *
 * O Firestore entra quando ha projeto configurado E o usuario pertence a uma
 * organizacao. Sem uma das duas coisas o caminho e o conjunto demonstrativo:
 * e o que mantem o repositorio clonavel sem projeto Firebase e o que da ao
 * administrador da plataforma uma area de trabalho para inspecionar cada
 * profissao sem tocar em dados de cliente nenhum.
 */
export function createWorkspaceRepository(
  options: WorkspaceRepositoryOptions,
): WorkspaceRepository {
  const { professionId, organizationId, userId, anchor = new Date(), scope } = options;

  if (!isDemoMode && organizationId) {
    return new FirestoreWorkspaceRepository(
      getDb(),
      organizationId,
      professionId,
      { userId },
    );
  }

  return new MemoryWorkspaceRepository(professionId, anchor, scope);
}
