import type { TermPair } from "@/types";

/**
 * Frases que concordam com o termo da profissao.
 *
 * O termo vem da tabela de profissoes ("sessao", "treino", "paciente"); o
 * artigo e o adjetivo em volta dele precisam acompanhar o genero, senao a tela
 * diz "Novo sessao". Toda frase flexionada da interface passa por aqui.
 */

/** Escolhe a forma masculina ou feminina de uma palavra que acompanha o termo. */
export function byGender(term: TermPair, masculine: string, feminine: string): string {
  return term.feminine ? feminine : masculine;
}

/** "Nova sessao", "Novo treino". */
export function newTerm(term: TermPair): string {
  return `${byGender(term, "Novo", "Nova")} ${term.singularLower}`;
}

/** "Nenhuma sessao", "Nenhum paciente". */
export function noTerm(term: TermPair): string {
  return `${byGender(term, "Nenhum", "Nenhuma")} ${term.singularLower}`;
}

/** "Proxima sessao", "Proximo treino". */
export function nextTerm(term: TermPair): string {
  return `${byGender(term, "Próximo", "Próxima")} ${term.singularLower}`;
}

/** "Proximas sessoes", "Proximos treinos". */
export function nextPluralTerm(term: TermPair): string {
  return `${byGender(term, "Próximos", "Próximas")} ${term.pluralLower}`;
}

/** "todas as sessoes", "todos os treinos". */
export function allTerm(term: TermPair): string {
  return `${byGender(term, "todos os", "todas as")} ${term.pluralLower}`;
}

/** "a primeira sessao", "o primeiro paciente". */
export function firstTerm(term: TermPair): string {
  return `${byGender(term, "o primeiro", "a primeira")} ${term.singularLower}`;
}

/** "uma sessao", "um paciente". */
export function indefiniteTerm(term: TermPair): string {
  return `${byGender(term, "um", "uma")} ${term.singularLower}`;
}
