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
  /**
   * Mensalidade que gerou este lancamento, e o mes dela (`AAAA-MM`). Ausente
   * ou nulo em lancamento avulso ou de atendimento.
   */
  recurringChargeId?: ID | null;
  period?: string | null;
  privacyRedaction?: PrivacyRedactionMark | null;
}

export const RECURRING_CHARGE_STATUSES = ["ACTIVE", "PAUSED", "ENDED"] as const;

export type RecurringChargeStatus = (typeof RECURRING_CHARGE_STATUSES)[number];

/**
 * Mensalidade de um cliente do profissional — o "assinante" do Mensaliza.
 *
 * O dinheiro nao passa pelo Atendara: a mensalidade so faz nascer, todo mes,
 * um `Transaction` comum a receber, e o resto do financeiro (atraso, baixa,
 * relatorio) trata como qualquer lancamento. Encerrar nao apaga: o historico
 * dos meses ja lancados continua.
 */
export interface RecurringCharge extends TenantScopedEntity {
  clientId: ID;
  /** Nulo depois da pseudonimizacao a pedido do titular. */
  clientName: string | null;
  professionalId: ID | null;
  description: string;
  amountInCents: number;
  method: PaymentMethod | null;
  /** Dia do vencimento, de 1 a 28 para caber em todo mes. */
  dueDay: number;
  /** Primeiro mes cobrado, `AAAA-MM`. */
  startPeriod: string;
  /**
   * Ultimo mes ja lancado. So se lanca mes posterior a ele: um mes que o
   * profissional apagou nao volta no dia seguinte.
   */
  lastLaunchedPeriod: string | null;
  status: RecurringChargeStatus;
  endedAt: ISODateString | null;
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

/**
 * Link de pagamento de um lancamento de mensalidade (cobrador, C2). Um por
 * lancamento, com o id dele; gerar de novo troca o token e o antigo deixa de
 * valer. So o backend grava.
 *
 * O token fica legivel para quem ve o financeiro para o profissional poder
 * copiar o link de novo: ele so abre o que essa mesma pessoa ja ve (valor,
 * vencimento, descricao) e aceita um comprovante. A busca publica e pelo hash.
 */
export interface PaymentLink extends TenantScopedEntity {
  transactionId: ID;
  token: string;
  tokenHash: string;
}

export const PAYMENT_PROOF_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED"] as const;

export type PaymentProofStatus = (typeof PAYMENT_PROOF_STATUSES)[number];

/**
 * Comprovante enviado pelo cliente pelo link (C2). O arquivo mora no Storage,
 * gravado pelo backend; aprovar marca o lancamento como pago.
 */
export interface PaymentProof extends TenantScopedEntity {
  transactionId: ID;
  recurringChargeId: ID | null;
  clientId: ID | null;
  status: PaymentProofStatus;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  /** Prova de que o arquivo exibido e o que chegou. */
  sha256: string;
  submittedAt: ISODateString;
  reviewedAt: ISODateString | null;
  reviewedBy: ID | null;
  rejectionReason: string | null;
  privacyRedaction?: PrivacyRedactionMark | null;
}

/**
 * Quem emite os recibos da organizacao (C3). Um documento so, preenchido uma
 * vez: serve ao autonomo (a organizacao e ele, com CPF) e a clinica (CNPJ).
 */
export interface ReceiptSettings extends TenantScopedEntity {
  issuerName: string;
  /** So digitos: CPF (11) ou CNPJ (14). */
  issuerDocument: string;
  issuerAddress: string;
  issuerCity: string;
}

export const RECEIPT_STATUSES = ["ISSUED", "CANCELLED"] as const;

export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/**
 * Recibo de pagamento (ADR 0004, 14.9). Emitido so pelo backend, com numero
 * sequencial da organizacao; emitido nao muda — erro se corrige cancelando
 * com motivo e emitindo outro, e o numero cancelado continua na sequencia.
 *
 * Guarda a copia do que foi impresso (emissor, pagador, valor por extenso),
 * nao referencias: mudar o cadastro depois nao reescreve recibo passado. O
 * `contentHash` prova que uma via reimpressa e igual a original.
 */
export interface Receipt extends TenantScopedEntity {
  number: number;
  transactionId: ID;
  clientId: ID | null;
  professionalId: ID | null;
  issuerName: string;
  issuerDocument: string;
  issuerAddress: string;
  issuerCity: string;
  /** "CRP 06/12345", quando a profissao e o profissional tem registro. */
  issuerRegistry: string | null;
  payerName: string;
  payerDocument: string | null;
  beneficiaryName: string | null;
  beneficiaryDocument: string | null;
  amountInCents: number;
  amountInWords: string;
  paidAt: ISODateString;
  method: PaymentMethod | null;
  description: string;
  officialTaxReceipt: "RECEITA_SAUDE" | null;
  issuedAt: ISODateString;
  status: ReceiptStatus;
  cancelledAt: ISODateString | null;
  cancelledBy: ID | null;
  cancellationReason: string | null;
  contentHash: string;
  privacyRedaction?: PrivacyRedactionMark | null;
}
