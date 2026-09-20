import type { AppointmentPart, Transaction } from "@/types";

/**
 * Os lançamentos de um atendimento, sem I/O.
 *
 * Um atendimento nasceu com um lançamento só. Hoje pode ter três: o trabalho,
 * o sinal antecipado (E2.2) e a taxa de deslocamento (E2.3). Quem decide qual
 * valor pertence a qual parte é este arquivo — as duas implementações do
 * repositório só executam.
 */

/**
 * Que parte do atendimento um lançamento cobre.
 *
 * Lançamento criado antes da E2.2 não tem a marca, e todos eles eram o
 * trabalho: sem este `??`, um atendimento antigo passaria a não ter receita
 * nenhuma aos olhos do código novo.
 */
export function partOf(
  transaction: Pick<Transaction, "appointmentPart">,
): AppointmentPart {
  return transaction.appointmentPart ?? "SERVICE";
}

export interface AppointmentCharges {
  /** O que fica a pagar pelo trabalho, já descontado o sinal. */
  serviceInCents: number;
  depositInCents: number | null;
  travelFeeInCents: number | null;
}

/**
 * Quanto um lançamento deve valer depois de uma alteração no atendimento.
 *
 * `null` significa que aquela cobrança deixou de existir — ela tirou o sinal
 * ou o deslocamento. Quem chama cancela o lançamento em vez de apagá-lo: linha
 * do financeiro não se apaga.
 */
export function amountForPart(
  part: AppointmentPart,
  charges: AppointmentCharges,
): number | null {
  if (part === "DEPOSIT") return charges.depositInCents;
  if (part === "TRAVEL") return charges.travelFeeInCents;
  return charges.serviceInCents;
}
