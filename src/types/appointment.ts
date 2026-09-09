import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { ServiceModality } from "./profession";

export type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "RESCHEDULED";

export type AppointmentOrigin =
  "MANUAL" | "AI_AGENT" | "CLIENT_SELF_SERVICE" | "IMPORTED";

/**
 * Referencia a um evento em calendario externo. O campo existe desde ja para
 * que a sincronizacao (Google/Outlook) na Fase 3 nao exija migracao de dados.
 */
export interface ExternalCalendarRef {
  provider: "GOOGLE" | "OUTLOOK" | "ICAL";
  externalEventId: string;
  syncedAt: ISODateString;
}

export interface Appointment extends TenantScopedEntity {
  clientId: ID;
  /** Desnormalizado para listagem de agenda sem N+1 leituras no Firestore. */
  clientName: string;
  professionalId: ID;
  professionalName: string;
  startsAt: ISODateString;
  endsAt: ISODateString;
  durationMinutes: number;
  modality: ServiceModality;
  status: AppointmentStatus;
  priceInCents: number;
  /** Observacao administrativa. Nao e registro clinico. */
  administrativeNotes: string | null;
  origin: AppointmentOrigin;
  confirmedAt: ISODateString | null;
  cancelledAt: ISODateString | null;
  cancellationReason: string | null;
  /** Preenchido quando este atendimento substitui outro remarcado. */
  rescheduledFromId: ID | null;
  externalCalendar: ExternalCalendarRef | null;
}
