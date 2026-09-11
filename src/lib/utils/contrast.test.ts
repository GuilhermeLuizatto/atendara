import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { contrastRatio, readOklchTokens, type Oklch } from "./contrast";

/**
 * WCAG 2.2 AA nos tokens de cor: 4,5:1 para texto (1.4.3) e 3:1 para a borda
 * que identifica um campo de formulario e para o indicador de foco (1.4.11).
 *
 * Os pares sao os que as telas usam de fato. Um token novo, ou um ajuste de
 * marca, que derrube um deles quebra o build antes de chegar a quem enxerga
 * pouco.
 */

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const light = readOklchTokens(css, ":root");
const dark = { ...light, ...readOklchTokens(css, ".dark") };

const TEXT: Array<[string, string]> = [
  ["foreground", "background"],
  ["foreground", "surface-muted"],
  ["muted-foreground", "background"],
  ["muted-foreground", "surface"],
  ["muted-foreground", "surface-muted"],
  ["subtle-foreground", "background"],
  ["subtle-foreground", "surface"],
  ["subtle-foreground", "surface-muted"],
  ["primary", "surface"],
  ["primary", "background"],
  ["primary-foreground", "primary"],
  ["primary-soft-foreground", "primary-soft"],
  ["danger", "surface"],
  ["danger", "background"],
  ["danger-foreground", "danger"],
  ["danger-soft-foreground", "danger-soft"],
  ["success-soft-foreground", "success-soft"],
  ["warning-soft-foreground", "warning-soft"],
  ["info-soft-foreground", "info-soft"],
  ["warning-soft-foreground", "surface"],
  ["danger-soft-foreground", "surface"],
  ["success-soft-foreground", "surface"],
];

const NON_TEXT: Array<[string, string]> = [
  ["input", "surface"],
  ["input", "background"],
  ["ring", "surface"],
  ["ring", "background"],
];

function accents(prefix: "" | ".dark "): Array<[string, Record<string, Oklch>]> {
  const pattern = new RegExp(`^${prefix.replace(".", "\\.")}\\[data-accent="(\\w+)"\\]`, "gm");
  return [...css.matchAll(pattern)].map(([, name]) => [
    name,
    readOklchTokens(css, `${prefix}[data-accent="${name}"]`),
  ]);
}

describe.each([
  ["claro", light],
  ["escuro", dark],
])("tokens do tema %s", (_, tokens) => {
  it.each(TEXT)("texto %s sobre %s tem 4,5:1", (foreground, background) => {
    expect(contrastRatio(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT)("%s sobre %s tem 3:1", (foreground, background) => {
    expect(contrastRatio(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(3);
  });
});

describe("cor de destaque das profissoes", () => {
  it.each(accents(""))("texto sobre destaque %s tem 4,5:1 no tema claro", (_, accent) => {
    expect(contrastRatio(light["accent-foreground"], accent.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accent.accent, accent["accent-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accent.accent, light.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(accents(".dark "))("texto sobre destaque %s tem 4,5:1 no tema escuro", (_, accent) => {
    expect(contrastRatio(dark["accent-foreground"], accent.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accent.accent, accent["accent-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accent.accent, dark.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
