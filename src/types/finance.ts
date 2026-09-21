import type { ID, ISODateString, TenantScopedEntity } from "./common";
import type { PrivacyRedactionMark } from "./privacy";

export type TransactionType = "INCOME" | "EXPENSE";

/**
 * Parte do atendimento coberta por um lancamento.
 *
 * `SERVICE` e o trabalho, `DEPOSIT` o sinal antecipado (E2.2) e `TRAVEL` a
 * taxa de deslocamento do atendimento a domicilio (E2.3). Separados de
 * proposito: no fim do mes ela enxerga quanto ganhou so indo ate a cliente.
 */
export type AppointmentPart = "SERVICE" | "DEPOSIT" | "TRAVEL";

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
  /**
   * Que parte do atendimento este lancamento cobre (E2.2). `SERVICE` e o que
   * fica a pagar; `DEPOSIT` e o sinal antecipado. `null` em lancamento que
   * nao nasce de atendimento.
   *
   * Existe porque um atendimento passou a ter DOIS lancamentos: procurar por
   * `appointmentId` sozinho nao diz mais qual e qual.
   */
  appointmentPart: AppointmentPart | null;
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
