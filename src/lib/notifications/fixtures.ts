import { NOTIFICATION_CONSENT_TEXT_VERSION } from "@/config/notifications";
import { defaultOrganizationSettings } from "@/config/organization";
import { getProfession } from "@/config/professions";
import type {
  Appointment,
  ChannelConsentRecord,
  Client,
  ConsentAct,
  NotificationConsent,
  NotificationDelivery,
  NotificationRule,
  Organization,
  OutboundChannel,
  ProfessionId,
} from "@/types";

/**
 * Fixtures dos testes de aviso.
 *
 * Todos os destinos sao ficticios por construcao: `.test` e `.invalid` sao TLDs
 * reservados (RFC 2606, RFC 6761) e os telefones usam DDD 00, que nao existe no
 * Brasil. Nenhum contato real do titular aparece aqui, e nenhum deve aparecer:
 * contato informado para configuracao futura nao e destino de teste.
 */

export const FICTITIOUS = {
  email: "destino@exemplo.test",
  phone: "+5500900000000",
} as const;

export const ANCHOR = "2026-09-10T12:00:00.000Z";
/** 12h depois da ancora — cabe numa antecedencia de 60 minutos. */
export const APPOINTMENT_START = "2026-09-11T00:00:00.000Z";

export function organization(
  overrides: {
    profession?: ProfessionId;
    enabled?: boolean;
    verifiedSenderChannels?: OutboundChannel[];
    rules?: NotificationRule[];
  } = {},
): Organization {
  const professionId = overrides.profession ?? "PERSONAL_TRAINER";
  const settings = defaultOrganizationSettings(getProfession(professionId));

  return {
    id: "org-teste",
    createdAt: ANCHOR,
    updatedAt: ANCHOR,
    createdBy: null,
    updatedBy: null,
    name: "Estúdio Exemplo",
    slug: "estudio-exemplo",
    kind: "SOLO_PRACTITIONER",
    primaryProfession: professionId,
    professions: [professionId],
    address: null,
    timezone: "America/Sao_Paulo",
    locale: "pt-BR",
    currency: "BRL",
    plan: "SOLO",
    ownerId: "dono",
    settings: {
      ...settings,
      notifications: {
        enabled: overrides.enabled ?? true,
        verifiedSenderChannels: overrides.verifiedSenderChannels ?? ["SMS"],
        rules: overrides.rules ?? [reminderRule()],
      },
    },
  };
}

export function reminderRule(
  overrides: Partial<NotificationRule> = {},
): NotificationRule {
  return {
    id: "regra-lembrete",
    event: "APPOINTMENT_REMINDER",
    channel: "SMS",
    enabled: true,
    leadMinutes: 60,
    customTemplate: null,
    ...overrides,
  };
}

/** uid ficticio de quem da equipe registra o consentimento nos testes. */
export const STAFF_MEMBER = "membro-da-equipe";

export function consentAct(overrides: Partial<ConsentAct> = {}): ConsentAct {
  return {
    at: ANCHOR,
    recordedBy: { kind: "STAFF", userId: STAFF_MEMBER },
    medium: "FORM",
    ...overrides,
  };
}

/** Registro completo e vigente de um canal, de pessoa adulta. */
export function consentRecord(
  overrides: Partial<ChannelConsentRecord> = {},
): ChannelConsentRecord {
  return {
    granted: consentAct(),
    textVersion: NOTIFICATION_CONSENT_TEXT_VERSION,
    subjectIsMinor: false,
    legalGuardian: null,
    withdrawn: null,
    ...overrides,
  };
}

export function consent(
  channels: NotificationConsent["channels"],
  legacy: NotificationConsent["legacy"] = null,
): NotificationConsent {
  return { formatVersion: 2, channels, legacy };
}

export function client(overrides: Partial<Client> = {}): Client {
  return {
    id: "cliente-1",
    organizationId: "org-teste",
    createdAt: ANCHOR,
    updatedAt: ANCHOR,
    createdBy: null,
    updatedBy: null,
    fullName: "Alex Fictício",
    preferredName: "Alex",
    email: FICTITIOUS.email,
    phone: FICTITIOUS.phone,
    status: "ACTIVE",
    preferredModality: "IN_PERSON",
    assignedProfessionalId: "prof-1",
    acquisitionChannel: "OTHER",
    tags: [],
    lastAppointmentAt: null,
    nextAppointmentAt: null,
    administrativeNotes: null,
    totalAppointments: 0,
    outstandingBalanceInCents: 0,
    appointmentNotificationsEnabled: true,
    notificationConsent: consent({
      SMS: [consentRecord()],
      EMAIL: [consentRecord()],
      WHATSAPP: [consentRecord()],
    }),
    ...overrides,
  };
}

export function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "atendimento-1",
    organizationId: "org-teste",
    createdAt: ANCHOR,
    updatedAt: ANCHOR,
    createdBy: null,
    updatedBy: null,
    clientId: "cliente-1",
    clientName: "Alex Fictício",
    professionalId: "prof-1",
    professionalName: "Sam Fictício",
    startsAt: APPOINTMENT_START,
    endsAt: "2026-09-11T01:00:00.000Z",
    durationMinutes: 60,
    modality: "IN_PERSON",
    status: "SCHEDULED",
    priceInCents: 12_000,
    administrativeNotes: null,
    origin: "MANUAL",
    confirmedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    rescheduledFromId: null,
    externalCalendar: null,
    ...overrides,
  };
}

export function delivery(
  overrides: Partial<NotificationDelivery> = {},
): NotificationDelivery {
  return {
    id: "entrega-1",
    organizationId: "org-teste",
    createdAt: ANCHOR,
    updatedAt: ANCHOR,
    createdBy: null,
    updatedBy: null,
    audience: "ORGANIZATION_TO_CLIENT",
    event: "APPOINTMENT_REMINDER",
    channel: "SMS",
    ruleId: "regra-lembrete",
    appointmentId: "atendimento-1",
    clientId: "cliente-1",
    professionalId: "prof-1",
    scheduledFor: ANCHOR,
    status: "PLANNED",
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    providerId: "SIMULATED",
    providerMessageId: null,
    failureCode: null,
    templateId: "profession:PERSONAL_TRAINER:APPOINTMENT_REMINDER",
    bodyHash: "00000000",
    bodyLength: 0,
    contactHint: "***0000",
    sentAt: null,
    cancelledAt: null,
    ...overrides,
  };
}
