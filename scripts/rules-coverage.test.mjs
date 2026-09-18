import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TENANT_COLLECTIONS, paths } from "../functions/generated/paths.js";

/**
 * Cobertura das Security Rules no CI (H.6).
 *
 * A prova de verdade — negacao testada para sessao de tenant E para a operadora
 * em cada colecao — roda em `npm run test:rules`, que precisa do emulador e de
 * Java, e por isso nao roda no CI hoje.
 *
 * Este teste e o que da para exigir sem emulador: uma colecao nova em
 * `firestore.rules` que nao aparece na suite das regras quebra o CI. Quem a
 * acrescentar na suite cai na conferencia por papel, que falha ate as negacoes
 * existirem.
 */

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const suite = readFileSync(new URL("./test-firestore-rules.mjs", import.meta.url), "utf8");

const ruleCollections = [...new Set([...rules.matchAll(/match \/(\w+)\/\{/g)].map((match) => match[1]))].filter(
  (name) => name !== "databases",
);

/** Colecao que cada helper de `paths` alcanca, calculada chamando o helper. */
function collectionsReachedByHelpers() {
  const reached = new Map();
  for (const [helper, build] of Object.entries(paths)) {
    if (helper === "collection" || helper === "document") continue;
    const path = build("x", "y", "z");
    const segments = path.split("/");
    // `accounts/x` -> accounts; `platformPlans` -> platformPlans.
    const name = segments.length % 2 === 0 ? segments.at(-2) : segments.at(-1);
    reached.set(helper, name);
  }
  return reached;
}

function mentioned(name, helpers) {
  for (const [helper, collection] of helpers) {
    if (collection === name && suite.includes(`paths.${helper}(`)) return true;
  }
  // Colecao de tenant passa pelo nome: `paths.document(org, "clients", id)`.
  const tenantKey = Object.entries(TENANT_COLLECTIONS).find(([, value]) => value === name)?.[0];
  if (tenantKey && suite.includes(`"${tenantKey}"`)) return true;
  // Mensagens moram numa subcolecao e tem helpers proprios.
  return name === "messages" && /messagesPath\(|messagePath\(/.test(suite);
}

describe("Cobertura das Security Rules", () => {
  it("le as colecoes das regras", () => {
    expect(ruleCollections.length).toBeGreaterThanOrEqual(20);
  });

  it("toda colecao das regras aparece na suite das regras", () => {
    const helpers = collectionsReachedByHelpers();
    const missing = ruleCollections.filter((name) => !mentioned(name, helpers));
    expect(missing).toEqual([]);
  });

  it("a suite das regras continua exigindo negacao por papel", () => {
    // Se alguem tirar a conferencia, a cobertura acima perde o sentido.
    expect(suite).toContain('for (const role of ["tenant", "operadora"])');
    expect(suite).toContain('assert.deepEqual(lacunas, [], "colecao sem negacao testada por papel")');
  });
});
