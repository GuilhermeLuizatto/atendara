/**
 * Política do atendimento a domicílio (E2.3), como DADO.
 *
 * Duas coisas moram aqui: o formato do endereço, que as Security Rules também
 * conferem em CEL, e a taxa de deslocamento. `lib/agenda/home-visit.ts`
 * executa.
 */

export const HOME_VISIT_LIMITS = {
  /**
   * Endereço curto demais não é endereço; longo demais é texto livre com
   * qualquer coisa dentro. O mesmo teto está em `firestore.rules` (regra 8 vale
   * para permissões, e este limite segue a mesma disciplina: mudou aqui, mude
   * lá, e o teste de regras cobra).
   */
  address: { min: 8, max: 200 },
  /** Deslocamento é cobrança, não desconto. */
  travelFeeInCents: { min: 0, max: 1_000_000 },
} as const;

/** Prefixo da descrição do lançamento da taxa. */
export const TRAVEL_DESCRIPTION_PREFIX = "Deslocamento";

export const HOME_VISIT_ERRORS = {
  NOT_AVAILABLE: "Esta profissão não registra endereço de atendimento.",
  /**
   * O endereço pertence ao atendimento a domicílio. Guardá-lo num atendimento
   * presencial espalharia dado pessoal por registros que não precisam dele.
   */
  MODALITY_MISMATCH: "O endereço só é registrado em atendimento a domicílio.",
  ADDRESS_TOO_SHORT: "Escreva o endereço completo, com número.",
  ADDRESS_TOO_LONG: "O endereço está longo demais.",
  TRAVEL_FEE_RANGE:
    "A taxa de deslocamento precisa ser um valor em reais, sem centavos quebrados.",
  TRAVEL_FEE_WITHOUT_VISIT:
    "A taxa de deslocamento só existe em atendimento a domicílio.",
} as const;
