/**
 * Edicao de campo com mascara, sem I/O. Conta so letras e numeros: a
 * pontuacao e da mascara e se refaz a cada tecla.
 */

const SIGNIFICANT = /[0-9A-Za-z]/;

const significantCount = (text: string): number => [...text].filter((character) => SIGNIFICANT.test(character)).length;

/** Posicao, no texto formatado, logo depois do n-esimo caractere que conta. */
function caretAfter(formatted: string, significant: number): number {
  if (significant <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index++) {
    if (SIGNIFICANT.test(formatted[index]) && ++seen === significant) return index + 1;
  }
  return formatted.length;
}

function withoutSignificantAt(text: string, position: number): string {
  let seen = -1;
  return [...text]
    .filter((character) => !(SIGNIFICANT.test(character) && ++seen === position))
    .join("");
}

/**
 * Aplica a mascara ao que o navegador deixou no campo. Apagar so um ponto ou
 * traco nao mudaria nada, porque a mascara o devolve; entao Backspace apaga o
 * caractere antes dele, e Delete o depois — como se o separador nao existisse.
 */
export function applyMask(
  raw: string,
  caret: number,
  previous: string,
  inputType: string | undefined,
  format: (raw: string) => string,
): { value: string; caret: number } {
  let text = raw;
  let before = significantCount(raw.slice(0, caret));
  const onlySeparatorRemoved = raw.length < previous.length && significantCount(raw) === significantCount(previous);
  if (onlySeparatorRemoved && inputType === "deleteContentBackward" && before > 0) {
    text = withoutSignificantAt(raw, before - 1);
    before -= 1;
  } else if (onlySeparatorRemoved && inputType === "deleteContentForward") {
    text = withoutSignificantAt(raw, before);
  }
  const value = format(text);
  return { value, caret: caretAfter(value, before) };
}
