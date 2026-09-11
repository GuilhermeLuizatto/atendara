import { AGENDA_SLOT_INTERVALS } from "@/config/organization";
import { hasPermission } from "@/config/permissions";
import type { AgendaSettings, Permission, ServiceModality } from "@/types";

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

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Horario de atendimento valido e normalizado. `allowDoubleBooking` passa como
 * veio: a politica de conflito de horario nao e decidida por esta tela.
 */
export function validateAgendaSettings(
  settings: AgendaSettings,
  modalities: readonly ServiceModality[],
): AgendaSettings {
  const workingDays = [...new Set(settings.workingDays)].sort((a, b) => a - b);
  if (
    workingDays.length === 0 ||
    workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    throw new RepositoryError("Escolha ao menos um dia de atendimento.");
  }
  if (
    !CLOCK_TIME.test(settings.workdayStart) ||
    !CLOCK_TIME.test(settings.workdayEnd) ||
    settings.workdayStart >= settings.workdayEnd
  ) {
    throw new RepositoryError("O inicio do expediente precisa ser antes do fim.");
  }
  if (!(AGENDA_SLOT_INTERVALS as readonly number[]).includes(settings.slotIntervalMinutes)) {
    throw new RepositoryError("Escolha um intervalo de agenda da lista.");
  }
  if (!modalities.includes(settings.defaultModality)) {
    throw new RepositoryError("Modalidade nao atendida por esta profissao.");
  }

  return {
    workingDays,
    workdayStart: settings.workdayStart,
    workdayEnd: settings.workdayEnd,
    slotIntervalMinutes: settings.slotIntervalMinutes,
    defaultModality: settings.defaultModality,
    allowDoubleBooking: settings.allowDoubleBooking,
  };
}

export function validateMessageBody(text: string): string {
  const body = text.trim();
  if (!body || body.length > 4000) {
    throw new RepositoryError("Escreva uma mensagem de 1 a 4000 caracteres.");
  }
  return body;
}
