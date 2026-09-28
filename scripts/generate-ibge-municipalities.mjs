import { writeFileSync } from "node:fs";

/**
 * Regrava `src/lib/geo/ibge-municipalities.json` a partir da API de
 * localidades do IBGE. Roda a mao, quando o IBGE instalar municipio novo:
 *
 *   node scripts/generate-ibge-municipalities.mjs
 *
 * A lista vai dentro do site para que nada do que se digita no campo de cidade
 * saia do navegador (decisao do titular em 27/09/2026).
 */

const SOURCE = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado";
const TARGET = "src/lib/geo/ibge-municipalities.json";

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`IBGE respondeu HTTP ${response.status}.`);
const rows = await response.json();

const byState = {};
for (const row of rows) {
  const state = row["UF-sigla"];
  const name = row["municipio-nome"];
  if (!/^[A-Z]{2}$/.test(state) || typeof name !== "string" || !name.trim()) {
    throw new Error("Linha fora do formato esperado na resposta do IBGE.");
  }
  (byState[state] ??= []).push(name.trim());
}

const collator = new Intl.Collator("pt-BR");
const states = Object.keys(byState).sort();
const sorted = Object.fromEntries(states.map((state) => [state, byState[state].sort(collator.compare)]));
const count = states.reduce((total, state) => total + sorted[state].length, 0);
if (states.length !== 27 || count < 5500) throw new Error(`Lista suspeita: ${states.length} UFs, ${count} municípios.`);

const data = {
  source: SOURCE,
  retrievedAt: new Date().toISOString().slice(0, 10),
  count,
  byState: sorted,
};
writeFileSync(TARGET, `${JSON.stringify(data)}\n`);
console.log(`${count} municípios em ${states.length} UFs gravados em ${TARGET}.`);
