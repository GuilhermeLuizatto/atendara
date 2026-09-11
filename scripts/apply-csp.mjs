import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { applyContentSecurityPolicy } from "./csp.mjs";
import { buildEnvironment } from "./public-env.mjs";

/**
 * Passo final do `npm run build`: grava a CSP em cada HTML de `out/`. Roda
 * depois do `next build` porque so entao o conteudo dos scripts inline — e
 * portanto o hash — existe.
 */

const OUT = "out";

async function* htmlFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

if (!existsSync(OUT)) {
  console.error("out/ nao existe. Rode `next build` antes de gravar a CSP.");
  process.exit(1);
}

const env = buildEnvironment();
const options = {
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || null,
};

let pages = 0;
for await (const path of htmlFiles(OUT)) {
  await writeFile(path, applyContentSecurityPolicy(await readFile(path, "utf8"), options));
  pages += 1;
}
console.log(`CSP gravada em ${pages} paginas.`);
