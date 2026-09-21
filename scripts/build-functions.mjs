import { mkdirSync, writeFileSync } from "node:fs";

import { generateModules } from "./generated-modules.mjs";

// Escreve os modulos que as functions leem. Roda na predeploy do deploy de
// functions. A geracao vive em `generated-modules.mjs` para que o teste possa
// conferir o que esta commitado sem precisar escrever em disco.
mkdirSync("functions/generated", { recursive: true });

for (const [target, code] of generateModules()) {
  writeFileSync(`functions/generated/${target}.js`, code);
}
