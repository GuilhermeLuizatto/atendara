// Gerado por scripts/build-functions.mjs.
/**
 * Frases que concordam com o termo da profissao.
 *
 * O termo vem da tabela de profissoes ("sessao", "treino", "paciente"); o
 * artigo e o adjetivo em volta dele precisam acompanhar o genero, senao a tela
 * diz "Novo sessao". Toda frase flexionada da interface passa por aqui.
 */
/** Escolhe a forma masculina ou feminina de uma palavra que acompanha o termo. */
export function byGender(term, masculine, feminine) {
    return term.feminine ? feminine : masculine;
}
/** "Nova sessao", "Novo treino". */
export function newTerm(term) {
    return `${byGender(term, "Novo", "Nova")} ${term.singularLower}`;
}
/** "Nenhuma sessao", "Nenhum paciente". */
export function noTerm(term) {
    return `${byGender(term, "Nenhum", "Nenhuma")} ${term.singularLower}`;
}
/** "Proxima sessao", "Proximo treino". */
export function nextTerm(term) {
    return `${byGender(term, "Próximo", "Próxima")} ${term.singularLower}`;
}
/** "Proximas sessoes", "Proximos treinos". */
export function nextPluralTerm(term) {
    return `${byGender(term, "Próximos", "Próximas")} ${term.pluralLower}`;
}
/** "todas as sessoes", "todos os treinos". */
export function allTerm(term) {
    return `${byGender(term, "todos os", "todas as")} ${term.pluralLower}`;
}
/** "a primeira sessao", "o primeiro paciente". */
export function firstTerm(term) {
    return `${byGender(term, "o primeiro", "a primeira")} ${term.singularLower}`;
}
/** "uma sessao", "um paciente". */
export function indefiniteTerm(term) {
    return `${byGender(term, "um", "uma")} ${term.singularLower}`;
}
