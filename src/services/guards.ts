import { AGENDA_SLOT_INTERVALS } from "@/config/organization";
import { hasPermission } from "@/config/permissions";
import {
  consentAuditMetadata,
  isAllowedConsentTransition,
  sameConsent,
} from "@/lib/notifications/consent-record";
import type {
  AgendaSettings,
  Permission,
  ServiceModality,
  StoredNotificationConsent,
} from "@/types";
import {
  AGENDA_SELF_SERVICE_LIMITS,
  agendaSelfServicePolicyOf,
} from "@/config/agenda-self-service";
import { policyOf } from "@/lib/agenda/reschedule";
import {
  hasAllProfessionalScope,
  hasAnyProfessionalScope,
  hasProfessionalScope,
  type ProfessionalScope,
} from "@/lib/access/professional-scope";

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

  if (!allowed) throw new RepositoryError("Sem permissão para esta ação.");
}

export function assertProfessionalScope(
  actor: RepositoryActor,
  professionalId: string | null | undefined,
): void {
  if (
    !hasProfessionalScope(
      {
        organizationWide:
          actor.organizationWideProfessionalScope === true ||
          actor.role === "OWNER" ||
          actor.role === "ADMIN",
        professionalIds: actor.linkedProfessionalIds ?? [],
      },
      professionalId,
    )
  ) {
    throw new RepositoryError(
      "Este registro pertence a um profissional fora dos seus vínculos ativos.",
    );
  }
}

function actorProfessionalScope(actor: RepositoryActor): ProfessionalScope {
  return {
    organizationWide:
      actor.organizationWideProfessionalScope === true ||
      actor.role === "OWNER" ||
      actor.role === "ADMIN",
    professionalIds: actor.linkedProfessionalIds ?? [],
  };
}

export function assertAnyProfessionalScope(
  actor: RepositoryActor,
  professionalIds: string[],
): void {
  if (
    !hasAnyProfessionalScope(actorProfessionalScope(actor), professionalIds)
  ) {
    throw new RepositoryError(
      "Este cadastro não pertence a nenhum dos seus vínculos ativos.",
    );
  }
}

export function assertAllProfessionalScope(
  actor: RepositoryActor,
  professionalIds: string[],
): void {
  if (
    !hasAllProfessionalScope(actorProfessionalScope(actor), professionalIds)
  ) {
    throw new RepositoryError(
      "A associação inclui um profissional fora dos seus vínculos ativos.",
    );
  }
}

export function assertClientProfessionalAssignment(
  assignedProfessionalIds: string[],
  professionalId: string,
): void {
  if (!assignedProfessionalIds.includes(professionalId)) {
    throw new RepositoryError(
      "Associe o cadastro ao profissional ativo antes de usar este contexto.",
    );
  }
}

/**
 * Escrita do consentimento de um cadastro: a mesma trava de `consentWriteOk()`
 * nas rules. Devolve o resumo para a trilha, ou `null` quando nada mudou.
 */
export function assertConsentWrite(
  actor: RepositoryActor,
  before: StoredNotificationConsent | null | undefined,
  after: StoredNotificationConsent | null | undefined,
): string | null {
  if (after === undefined || sameConsent(before, after)) return null;

  assertPermission(actor, "notificationConsent:record");
  if (!isAllowedConsentTransition(before, after, actor.userId)) {
    throw new RepositoryError(
      "O consentimento só aceita registrar ou retirar um canal, por quem está usando o painel. O histórico não pode ser apagado nem reescrito.",
    );
  }
  return consentAuditMetadata(before, after);
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
    throw new RepositoryError(
      "O início do expediente precisa ser antes do fim.",
    );
  }
  if (
    !(AGENDA_SLOT_INTERVALS as readonly number[]).includes(
      settings.slotIntervalMinutes,
    )
  ) {
    throw new RepositoryError("Escolha um intervalo de agenda da lista.");
  }
  if (!modalities.includes(settings.defaultModality)) {
    throw new RepositoryError("Modalidade não atendida por esta profissão.");
  }

  const selfService = agendaSelfServicePolicyOf(settings.selfService);
  const within = (value: number, limits: { min: number; max: number }) =>
    Number.isInteger(value) && value >= limits.min && value <= limits.max;
  if (
    !within(
      selfService.minimumCancellationNoticeHours,
      AGENDA_SELF_SERVICE_LIMITS.minimumCancellationNoticeHours,
    ) ||
    !within(
      selfService.offeredSlots,
      AGENDA_SELF_SERVICE_LIMITS.offeredSlots,
    ) ||
    !within(
      selfService.searchWindowDays,
      AGENDA_SELF_SERVICE_LIMITS.searchWindowDays,
    )
  ) {
    throw new RepositoryError(
      "Revise os limites do autoatendimento da agenda.",
    );
  }

  return {
    reschedule: policyOf(settings.reschedule),
    selfService,
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
