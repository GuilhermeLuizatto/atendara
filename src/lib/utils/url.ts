/**
 * URL externa vinda de dado gravado, pronta para `href`.
 *
 * So `https:`. O valor chega do banco — hoje espelhado de um evento assinado
 * pelo gateway —, e `javascript:` ou `data:` num `href` executam no nosso
 * dominio no clique. Qualquer outra coisa vira `null` e a tela nao mostra link.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
