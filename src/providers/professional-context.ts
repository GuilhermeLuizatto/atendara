import type { Professional } from "@/types";
import type { ProfessionalScope } from "@/lib/access/professional-scope";
import type { WorkspaceSnapshot } from "@/services";

/**
 * Profissionais que podem virar contexto operacional nesta sessão.
 * Perfil inativo nunca aparece como aba, mesmo para um papel organizacional.
 */
export function availableProfessionalContexts(
  professionals: Professional[],
  scope: ProfessionalScope,
): Professional[] {
  return professionals.filter(
    (professional) =>
      professional.active &&
      (scope.organizationWide || scope.professionalIds.includes(professional.id)),
  );
}

/** A preferência só vale enquanto ainda representa um vínculo ativo. */
export function resolveActiveProfessionalId(
  preferredId: string | null | undefined,
  available: Professional[],
): string | null {
  if (preferredId && available.some((item) => item.id === preferredId)) {
    return preferredId;
  }
  return available[0]?.id ?? null;
}

/**
 * Recorta uma fotografia já autorizada para uma única aba profissional.
 * O repositório continua com o conjunto necessário às regras e às escritas;
 * somente o que as telas operacionais consomem deixa de combinar contextos.
 */
export function snapshotForProfessional(
  snapshot: WorkspaceSnapshot,
  professionalId: string | null,
): WorkspaceSnapshot {
  if (!professionalId) {
    return {
      ...snapshot,
      clients: [],
      appointments: [],
      conversations: [],
      messages: [],
      transactions: [],
      recurringCharges: [],
      paymentLinks: [],
      paymentProofs: [],
      receipts: [],
      rules: snapshot.rules.filter((rule) => rule.professionalId == null),
      decisions: [],
      decisionReviews: [],
      notifications: [],
      notificationDeliveries: [],
      automationTasks: [],
      calendarBusy: [],
    };
  }

  const belongsToActiveProfessional = (item: { professionalId: string | null }) =>
    item.professionalId === professionalId;

  return {
    ...snapshot,
    clients: snapshot.clients.filter((client) =>
      client.assignedProfessionalIds.includes(professionalId),
    ),
    appointments: snapshot.appointments.filter(belongsToActiveProfessional),
    conversations: snapshot.conversations.filter(belongsToActiveProfessional),
    messages: snapshot.messages.filter(belongsToActiveProfessional),
    transactions: snapshot.transactions.filter(belongsToActiveProfessional),
    recurringCharges: (snapshot.recurringCharges ?? []).filter(
      belongsToActiveProfessional,
    ),
    paymentLinks: (snapshot.paymentLinks ?? []).filter(belongsToActiveProfessional),
    paymentProofs: (snapshot.paymentProofs ?? []).filter(
      belongsToActiveProfessional,
    ),
    receipts: (snapshot.receipts ?? []).filter(belongsToActiveProfessional),
    rules: snapshot.rules.filter(
      (rule) => rule.professionalId == null || rule.professionalId === professionalId,
    ),
    decisions: snapshot.decisions.filter(belongsToActiveProfessional),
    decisionReviews: (snapshot.decisionReviews ?? []).filter(
      belongsToActiveProfessional,
    ),
    notifications: snapshot.notifications.filter(belongsToActiveProfessional),
    notificationDeliveries: snapshot.notificationDeliveries.filter(
      belongsToActiveProfessional,
    ),
    automationTasks: snapshot.automationTasks.filter(belongsToActiveProfessional),
    calendarBusy: (snapshot.calendarBusy ?? []).filter(belongsToActiveProfessional),
  };
}
