import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { generateModules } from "./generated-modules.mjs";

/**
 * A trava que faltava quando o cadastro parou, em 21/09/2026.
 *
 * Constante compartilhada existe em dois lugares publicados por caminhos
 * diferentes: o site lê `src/config/`, as functions leem
 * `functions/generated/`, o site sobe sozinho no merge e as functions sobem à
 * mão. O PR #42 mudou o `LEGAL_VERSION`, o site subiu com o valor novo, as
 * functions ficaram com o velho, e `self-service.js` passou a recusar todo
 * cadastro — porque é exatamente isso que ele confere.
 *
 * A predeploy regenera antes de publicar, então o arquivo commitado defasado
 * não derruba produção sozinho. O que ele faz é pior: esconde a divergência de
 * quem lê o repositório. Este teste tira o esconderijo.
 *
 * Fim de linha não entra na comparação: o gerador escreve LF e o Git do
 * Windows guarda CRLF, o que faria o teste falhar sem nada estar errado.
 */
const semFimDeLinha = (texto) => texto.replace(/\r\n/g, "\n");

/** A constante, lida do texto do módulo — sem importar TypeScript no teste. */
function versaoLegalEm(caminho) {
  const conteudo = readFileSync(caminho, "utf8");
  return conteudo.match(/LEGAL_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? null;
}

describe("módulos gerados para as functions", () => {
  const gerados = generateModules();

  it("o que está commitado é igual ao que o gerador produz", () => {
    const divergentes = [];

    for (const [alvo, esperado] of gerados) {
      const caminho = `functions/generated/${alvo}.js`;
      let commitado;
      try {
        commitado = readFileSync(caminho, "utf8");
      } catch {
        divergentes.push(`${caminho} (não existe)`);
        continue;
      }
      if (semFimDeLinha(commitado) !== semFimDeLinha(esperado)) divergentes.push(caminho);
    }

    expect(
      divergentes,
      "rode `node scripts/build-functions.mjs` e commite o resultado",
    ).toEqual([]);
  });

  it("a versão legal do site e a das functions são a mesma", () => {
    const noSite = versaoLegalEm("src/config/legal.ts");
    const nasFunctions = versaoLegalEm("functions/generated/legal-config.js");

    expect(noSite, "LEGAL_VERSION sumiu de src/config/legal.ts").toBeTruthy();
    expect(
      nasFunctions,
      `o site envia "${noSite}" e as functions esperam "${nasFunctions}" — o cadastro seria recusado`,
    ).toBe(noSite);
  });

  it("todo módulo gerado tem a marca de que é gerado", () => {
    const semMarca = [...gerados]
      .filter(([, code]) => !code.startsWith("// Gerado por scripts/build-functions.mjs."))
      .map(([alvo]) => alvo);

    expect(semMarca).toEqual([]);
  });
});
