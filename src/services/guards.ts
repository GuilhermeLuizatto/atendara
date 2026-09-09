import { hasPermission } from "@/config/permissions";
import type { Permission } from "@/types";

import { RepositoryError, type RepositoryActor } from "./types";

/**
 * Guardas compartilhadas pelas duas implementacoes do repositorio.
 *
 * A checagem no cliente nao e barreira de seguranca — as Security Rules sao.
 * Ela existe para que a mensagem de erro chegue ao usuario antes da ida ao
 * servidor, e para que memoria e Firestore recusem exatamente as mesmas acoes.
 */

export function assertPermission(
  actor: RepositoryActor,
  permission: Permission,
): void {
  const allowed = actor.permissions
    ? actor.permissions.includes(permission)
    : hasPermission(actor.role ?? "VIEWER", permission);

  if (!allowed) throw new RepositoryError("Sem permissao para esta acao.");
}

export function validateMessageBody(text: string): string {
  const body = text.trim();
  if (!body || body.length > 4000) {
    throw new RepositoryError("Escreva uma mensagem de 1 a 4000 caracteres.");
  }
  return body;
}
