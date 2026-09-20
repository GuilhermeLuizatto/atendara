import {
  DEPOSIT_ERRORS,
  DEPOSIT_LIMITS,
  type DepositChoice,
} from "@/config/deposit";
import type {
  AppointmentPart,
  AppointmentStatus,
  DepositOutcome,
  ISODateString,
  Transaction,
} from "@/types";

/**
 * Regras do sinal antecipado (E2.2), sem I/O.
 *
 * Vive junto da agenda, e não do financeiro, porque quem decide o destino do
 * sinal é o que aconteceu com o **atendimento**. O financeiro só executa o que
 * for decidido aqui, e as duas implementações do repositório chamam as mesmas
 * funções: dinheiro não pode ter duas respostas.
 */

/**
 * Que parte do atendimento um lancamento cobre.
 *
 * Lancamento criado antes da E2.2 nao tem a marca, e todos eles eram a receita
 * do servico: sem este `??`, um atendimento antigo passaria a nao ter receita
 * nenhuma aos olhos do codigo novo.
 */
export function partOf(
  transaction: Pick<Transaction, "appointmentPart">,
): AppointmentPart {
  return transaction.appointmentPart ?? "SERVICE";
}

export type DepositValidation =
  { ok: true; value: number | null } | { ok: false; error: string };

/**
 * Valida o sinal digitado na marcação.
 *
 * `null` e `0` significam a mesma coisa — não pediu sinal — e saem daqui
 * sempre como `null`, para o resto do código ter um caso só.
 */
export function validateDeposit(input: {
  depositInCents: number | null;
  priceInCents: number;
  available: boolean;
}): DepositValidation {
  const { depositInCents, priceInCents, available } = input;
  if (depositInCents === null || depositInCents === 0)
    return { ok: true, value: null };
  if (!available) return { ok: false, error: DEPOSIT_ERRORS.NOT_AVAILABLE };
  if (!Number.isInteger(depositInCents))
    return { ok: false, error: DEPOSIT_ERRORS.NOT_INTEGER };
  if (depositInCents < DEPOSIT_LIMITS.minInCents)
    return { ok: false, error: DEPOSIT_ERRORS.NEGATIVE };
  if (priceInCents <= 0) return { ok: false, error: DEPOSIT_ERRORS.NO_PRICE };
  if (depositInCents > priceInCents)
    return { ok: false, error: DEPOSIT_ERRORS.OVER_PRICE };
  return { ok: true, value: depositInCents };
}

/**
 * Quanto fica a pagar depois do sinal. O sinal abate (decisão do titular,
 * 20/09): os dois lançamentos somados dão o valor do atendimento.
 */
export function serviceAmountFor(
  priceInCents: number,
  depositInCents: number | null,
): number {
  return Math.max(0, priceInCents - (depositInCents ?? 0));
}

/**
 * Quando o sinal vence: no prazo da política, ou no atendimento, o que vier
 * primeiro. Atendimento que já passou deixa o sinal vencido de saída, e é isso
 * mesmo — o horário foi.
 */
export function depositDueDate(now: ISODateString, startsAt: ISODateString): ISODateString {
  const prazo = new Date(
    new Date(now).getTime() + DEPOSIT_LIMITS.dueWithinHours * 3_600_000,
  ).toISOString();
  return prazo < startsAt ? prazo : startsAt;
}

export interface DepositSettlement {
  /** O que fazer com o lançamento do sinal. */
  deposit: "UNCHANGED" | "KEEP_PAID" | "REFUND" | "CANCEL";
  /** O que fazer com a receita do serviço, o que fica a pagar. */
  service: "UNCHANGED" | "CANCEL";
  /** O que vai para o atendimento e para a trilha. */
  outcome: DepositOutcome | null;
}

const NOTHING: DepositSettlement = {
  deposit: "UNCHANGED",
  service: "UNCHANGED",
  outcome: null,
};

/**
 * O destino do sinal quando o atendimento muda de estado.
 *
 * Duas decisões do titular (20/09) moram aqui:
 *
 * - **Cancelamento** pergunta na tela. Reter é o padrão — é para isso que o
 *   sinal existe —, e devolver é ato deliberado. Sinal ainda NÃO pago não tem
 *   o que reter: a cobrança cai junto com a do serviço.
 * - **Falta sem aviso** retém sem perguntar, e o que ficou a pagar cai. Cobrar
 *   o valor cheio por cima do sinal retido seria cobrar duas vezes pela mesma
 *   falta.
 */
export function settleDeposit(input: {
  status: AppointmentStatus;
  hasDeposit: boolean;
  depositPaid: boolean;
  choice: DepositChoice | null;
}): DepositSettlement {
  const { status, hasDeposit, depositPaid, choice } = input;

  if (status === "CANCELLED") {
    if (!hasDeposit)
      return { deposit: "UNCHANGED", service: "CANCEL", outcome: null };
    if (!depositPaid)
      return { deposit: "CANCEL", service: "CANCEL", outcome: null };
    return choice === "REFUND"
      ? { deposit: "REFUND", service: "CANCEL", outcome: "REFUNDED" }
      : { deposit: "KEEP_PAID", service: "CANCEL", outcome: "KEPT" };
  }

  if (status === "NO_SHOW" && hasDeposit && depositPaid) {
    return { deposit: "KEEP_PAID", service: "CANCEL", outcome: "KEPT" };
  }

  return NOTHING;
}

/** A tela só precisa perguntar quando há dinheiro dela em jogo. */
export function asksAboutDeposit(input: {
  status: AppointmentStatus;
  hasDeposit: boolean;
  depositPaid: boolean;
}): boolean {
  return input.status === "CANCELLED" && input.hasDeposit && input.depositPaid;
}
