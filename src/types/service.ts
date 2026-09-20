import type { ISODateString, TenantScopedEntity } from "./common";
import type { PrivacyRedactionMark } from "./privacy";

/**
 * Serviço do catálogo da organização (Estética, E2.1).
 *
 * **Preço e duração são sempre da profissional.** O Atendara não traz tabela de
 * preço, não sugere valor e não tem "preço de mercado": quem cobra sabe quanto
 * cobra. O catálogo inicial nasce sem preço e desligado, justamente para que
 * nenhum número que ela não escolheu chegue perto de um cliente.
 *
 * A coleção só existe para profissão com `features.serviceCatalog` — hoje só a
 * Estética. Nenhuma tela pergunta qual é a profissão: pergunta pela flag.
 */
export interface Service extends TenantScopedEntity {
  name: string;
  /** Descrição curta, para a própria equipe. Não sai em aviso. */
  description: string | null;
  /**
   * Quanto o atendimento ocupa na agenda, em minutos. Serviço ligado tem
   * duração: sem ela, a agenda não sabe quanto tempo reservar.
   */
  durationMinutes: number | null;
  /** Em centavos inteiros (regra 7). `null` enquanto ela não definiu. */
  priceInCents: number | null;
  /**
   * Ligado = pronto para usar na agenda. Só liga com preço **e** duração
   * (decisão do titular, 20/09): ligado sem duração quebra a agenda, e ligado
   * sem preço quebra o financeiro.
   */
  enabled: boolean;
  /**
   * Sugestão de retorno, em dias. Aparece na tela depois do atendimento e
   * **não envia nada** — envio tem as travas da regra 11, e a E2.4 decide isso.
   */
  returnIntervalDays: number | null;
  /** Ordem escolhida por ela na lista. Menor primeiro. */
  position: number;
  archivedAt: ISODateString | null;
  privacyRedaction?: PrivacyRedactionMark | null;
}

/** O que o formulário envia. Id, ordem e carimbos são do repositório. */
export interface ServiceInput {
  name: string;
  description: string | null;
  durationMinutes: number | null;
  priceInCents: number | null;
  enabled: boolean;
  returnIntervalDays: number | null;
}
