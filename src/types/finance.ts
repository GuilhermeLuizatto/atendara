import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { PrivacyRedactionMark } from "./privacy";

export type TransactionType = "INCOME" | "EXPENSE";

export type TransactionStatus =
  "PENDING" | "PAID" | "OVERDUE" | "CANCELLED" | "REFUNDED";

export type PaymentMethod =
  | "PIX"
  | "CREDIT_CARD"
  | "DEBIT_CARD"
  | "BANK_TRANSFER"
  | "CASH"
  | "INSURANCE"
  | "OTHER";

/**
 * Campos de gateway ja previstos para a Fase 5. Nulos no prototipo; a
 * existencia deles evita migracao quando a cobranca real for plugada.
 */
export interface PaymentGatewayRef {
  provider: "STRIPE" | "MERCADO_PAGO" | "ASAAS" | "PAGARME";
  externalChargeId: string;
  externalStatus: string;
}

export interface Transaction extends TenantScopedEntity {
  type: TransactionType;
  clientId: ID | null;
  clientName: string | null;
  professionalId: ID | null;
  appointmentId: ID | null;
  description: string;
  amountInCents: number;
  status: TransactionStatus;
  method: PaymentMethod | null;
  /** Data de vencimento; base para o calculo de atraso. */
  dueDate: ISODateString;
  paidAt: ISODateString | null;
  gateway: PaymentGatewayRef | null;
  privacyRedaction?: PrivacyRedactionMark | null;
}

/** Agregados calculados para o dashboard e a tela financeira. */
export interface FinanceSummary {
  paidInCents: number;
  pendingInCents: number;
  overdueInCents: number;
  expensesInCents: number;
  netInCents: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
}
