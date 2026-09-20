/**
 * Política do sinal antecipado (E2.2), como DADO.
 *
 * `lib/finance/deposit.ts` executa; este arquivo decide o que vale. Quem
 * trabalha com sinal é a profissão que tem `features.depositOnBooking` — e o
 * valor do sinal é sempre escolhido por quem atende, como o preço.
 */

export const DEPOSIT_LIMITS = {
  /** Um centavo é sinal; zero é "não pedi sinal". */
  minInCents: 1,
  /**
   * Prazo para pagar o sinal, a partir da marcação.
   *
   * Sem prazo nenhum o sinal venceria no instante em que nasce e a tela diria
   * "em atraso" um segundo depois de marcar — que é falso e assusta à toa.
   * O prazo nunca passa do próprio atendimento: sinal pago depois do
   * atendimento não é sinal.
   */
  dueWithinHours: 24,
} as const;

/**
 * Decisão do titular (20/09): o sinal **abate** do valor do atendimento. Com
 * R$ 200 e sinal de R$ 50, o financeiro mostra "Sinal R$ 50" e o serviço a
 * R$ 150 — os dois somam o que ela cobra, e não R$ 250.
 */
export const DEPOSIT_DEDUCTS_FROM_PRICE = true;

/** Prefixo da descrição do lançamento, para a linha do financeiro se explicar. */
export const DEPOSIT_DESCRIPTION_PREFIX = "Sinal";

export const DEPOSIT_ERRORS = {
  NOT_AVAILABLE: "Esta profissão não trabalha com sinal antecipado.",
  NOT_INTEGER: "O sinal precisa ser um valor em reais, sem centavos quebrados.",
  NEGATIVE: "O sinal não pode ser negativo.",
  /**
   * Sinal maior que o valor deixaria o serviço com receita negativa — e uma
   * linha negativa no financeiro é a melhor forma de esconder um erro de
   * digitação.
   */
  OVER_PRICE: "O sinal não pode passar do valor do atendimento.",
  NO_PRICE: "Informe o valor do atendimento antes de pedir sinal.",
} as const;

/**
 * O que a tela oferece quando um atendimento com sinal **pago** é cancelado.
 * Reter é o padrão, porque é para isso que o sinal existe; devolver é um ato
 * deliberado, e os dois ficam na trilha.
 */
export const DEPOSIT_CHOICES = ["KEEP", "REFUND"] as const;
export type DepositChoice = (typeof DEPOSIT_CHOICES)[number];
export const DEFAULT_DEPOSIT_CHOICE: DepositChoice = "KEEP";

export const DEPOSIT_CHOICE_LABELS: Record<DepositChoice, string> = {
  KEEP: "Reter o sinal",
  REFUND: "Devolver o sinal",
};
