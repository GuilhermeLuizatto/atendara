import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Matriz de acesso ponta a ponta: Auth, callable functions e Security Rules
 * conversando de verdade, com as REGRAS REAIS carregadas.
 *
 * Separada da suite de repositorio porque as duas precisam de configuracoes
 * opostas do emulador: aquela roda com regras abertas para exercitar a fiacao,
 * esta existe justamente para provar que as regras recusam o que devem.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.access-test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // A matriz e uma sequencia: cadastro, troca de senha, restricoes. Rodar em
    // paralelo embaralharia o estado da mesma conta.
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
