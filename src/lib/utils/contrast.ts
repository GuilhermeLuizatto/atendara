/**
 * Contraste WCAG entre cores OKLCH, para conferir os tokens de
 * `src/app/globals.css` sem navegador.
 *
 * A conversao segue a definicao do OKLab (Ottosson): OKLCH -> OKLab -> sRGB
 * linear, com a luminancia relativa calculada no espaco linear, que e o que a
 * formula do WCAG pede. Cor fora do gamut e cortada, como o navegador faz.
 */

export type Oklch = readonly [lightness: number, chroma: number, hue: number];

export const WHITE: Oklch = [1, 0, 0];

export function relativeLuminance([lightness, chroma, hue]: Oklch): number {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: Oklch, second: Oklch): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (x, y) => y - x,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** `--nome: oklch(l c h)` de um bloco `seletor { ... }`. */
export function readOklchTokens(css: string, selector: string): Record<string, Oklch> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return {};
  const body = css.slice(start, css.indexOf("}", start));
  const tokens: Record<string, Oklch> = {};
  for (const [, name, l, c, h] of body.matchAll(
    /--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g,
  )) {
    tokens[name] = [Number(l), Number(c), Number(h)];
  }
  return tokens;
}
