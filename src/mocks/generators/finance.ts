import { atTime, shiftDays } from "@/mocks/dates";
import type {
  Appointment,
  Client,
  PaymentMethod,
  Transaction,
  TransactionStatus,
} from "@/types";

import { stamp, type GeneratorContext } from "./context";

const METHODS: PaymentMethod[] = [
  "PIX",
  "CREDIT_CARD",
  "DEBIT_CARD",
  "BANK_TRANSFER",
  "CASH",
];

const EXPENSES: [string, number][] = [
  ["Aluguel da sala", 180000],
  ["Assinatura do sistema", 14900],
  ["Material de consumo", 32000],
  ["Contabilidade", 45000],
];

/**
 * Financeiro derivado da agenda: cada atendimento realizado vira uma receita, e
 * os proximos viram pendencias. E o mesmo encadeamento do produto real, entao o
 * dashboard financeiro bate com a agenda sem numeros inventados a parte.
 */
export function buildTransactions(
  ctx: GeneratorContext,
  appointments: Appointment[],
): Transaction[] {
  const { rng, organizationId, now, today } = ctx;
  const transactions: Transaction[] = [];
  let sequence = 0;

  for (const appointment of appointments) {
    const isBillable =
      appointment.status === "COMPLETED" ||
      appointment.status === "CONFIRMED" ||
      appointment.status === "SCHEDULED";
    if (!isBillable) continue;

    const isPast = appointment.status === "COMPLETED";
    let status: TransactionStatus;
    if (isPast) {
      status = rng.bool(0.88) ? "PAID" : "OVERDUE";
    } else {
      status = "PENDING";
    }

    sequence += 1;
    transactions.push({
      id: `txn-${sequence}`,
      organizationId,
      ...stamp(now),
      type: "INCOME",
      clientId: appointment.clientId,
      clientName: appointment.clientName,
      professionalId: appointment.professionalId,
      appointmentId: appointment.id,
      description: `Atendimento de ${appointment.clientName}`,
      amountInCents: appointment.priceInCents,
      status,
      method: status === "PAID" ? rng.pick(METHODS) : null,
      dueDate: appointment.startsAt,
      paidAt: status === "PAID" ? appointment.endsAt : null,
      gateway: null,
    });
  }

  EXPENSES.forEach(([description, amountInCents], index) => {
    sequence += 1;
    transactions.push({
      id: `txn-${sequence}`,
      organizationId,
      ...stamp(now),
      type: "EXPENSE",
      clientId: null,
      clientName: null,
      professionalId: null,
      appointmentId: null,
      description,
      amountInCents,
      status: "PAID",
      method: "BANK_TRANSFER",
      dueDate: atTime(shiftDays(today, -(index + 2)), 12),
      paidAt: atTime(shiftDays(today, -(index + 2)), 12),
      gateway: null,
    });
  });

  return transactions;
}

/** Saldo em aberto por cliente: pendentes e atrasados. */
export function applyOutstandingBalances(
  clients: Client[],
  transactions: Transaction[],
): Client[] {
  const balances = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.type !== "INCOME" || !transaction.clientId) continue;
    if (transaction.status !== "PENDING" && transaction.status !== "OVERDUE") {
      continue;
    }
    balances.set(
      transaction.clientId,
      (balances.get(transaction.clientId) ?? 0) + transaction.amountInCents,
    );
  }

  return clients.map((client) => ({
    ...client,
    outstandingBalanceInCents: balances.get(client.id) ?? 0,
  }));
}
