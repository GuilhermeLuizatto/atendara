import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "functions/**/*.test.js", "scripts/**/*.test.mjs"],
    // So com `--coverage` (`npm run test:coverage`): o `lcov` alimenta o
    // SonarQube Cloud. Os gerados sao copia transpilada de `src/`, e contar
    // os dois mediria o mesmo codigo duas vezes.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}", "functions/**/*.js"],
      exclude: [
        "**/*.test.*",
        "**/*.emulator-test.*",
        "**/*.access-test.*",
        "functions/generated/**",
        "functions/node_modules/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
