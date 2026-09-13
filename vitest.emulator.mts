import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Suite de integracao contra o emulador do Firestore.
 *
 * Separada da suite normal de proposito: `npm test` precisa continuar rodando
 * em menos de um segundo, sem Java, sem emulador e sem rede. Aqui o alvo e
 * outro — provar que o repositorio realmente grava e le o que promete.
 */
export default defineConfig({
  test: {
    environment: "node",
    // O backend da fila de automacao usa o mesmo banco: transacao e consulta
    // dentro de transacao so falham contra um Firestore de verdade.
    include: ["src/**/*.emulator-test.ts", "functions/**/*.emulator-test.js"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Um unico banco compartilhado; suites em paralelo disputariam os mesmos
    // documentos.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
