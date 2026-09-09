import type {
  AppointmentStatus,
  AttentionLevel,
  ClassificationTone,
  ClientStatus,
  TransactionStatus,
} from "@/types";

import type { BadgeTone } from "./badge";

/**
 * Traducao de estado do dominio para tom visual.
 *
 * Fica na camada de UI (que pode conhecer o dominio) e nao em `config/` (que
 * nao deve conhecer componentes). Concentrar aqui evita ternario de cor
 * espalhado por tela.
 */

export const APPOINTMENT_STATUS_TONE: Record<AppointmentStatus, BadgeTone> = {
  SCHEDULED: "neutral",
  CONFIRMED: "success",
  COMPLETED: "primary",
  CANCELLED: "danger",
  NO_SHOW: "warning",
  RESCHEDULED: "info",
};

export const ATTENTION_TONE: Record<AttentionLevel, BadgeTone> = {
  NORMAL: "neutral",
  ATTENTION: "warning",
  HIGH: "warning",
  CRITICAL: "danger",
};

export const CLASSIFICATION_TONE: Record<ClassificationTone, BadgeTone> = {
  neutral: "neutral",
  informative: "info",
  professional: "primary",
  warning: "warning",
  critical: "danger",
};

export const CLIENT_STATUS_TONE: Record<ClientStatus, BadgeTone> = {
  LEAD: "info",
  ACTIVE: "success",
  INACTIVE: "neutral",
  ON_HOLD: "warning",
  DISCHARGED: "neutral",
};

export const TRANSACTION_STATUS_TONE: Record<TransactionStatus, BadgeTone> = {
  PENDING: "warning",
  PAID: "success",
  OVERDUE: "danger",
  CANCELLED: "neutral",
  REFUNDED: "info",
};
