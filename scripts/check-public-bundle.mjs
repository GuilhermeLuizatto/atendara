import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { contentSecurityPolicyProblems } from "./csp.mjs";
import { buildEnvironment } from "./public-env.mjs";

/**
 * Confere o que o `next build` deixou em `out/` — o que vai ao ar.
 *
 * `NEXT_PUBLIC_*` entra literal no bundle, e um valor sensivel colocado ali por
 * engano passa pelo lint, pelos tipos e pelos testes. So olhando o artefato da
 * para afirmar que ele nao saiu. Foi assim que o verificador do administrador
 * demo chegou ao Hosting em 09/09/2026.
 *
 * Nunca imprime o valor encontrado: so o arquivo e o nome do que vazou.
 */

const OUT = "out";

const env = buildEnvironment();

const firebaseConfigured = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
].every((name) => Boolean(env[name]));
const demoBuild = env.NEXT_PUBLIC_DEMO_MODE === "true" || !firebaseConfigured;

/** Valores exatos que nao podem aparecer. */
const forbiddenValues = [];
if (!demoBuild) {
  for (const name of ["NEXT_PUBLIC_DEMO_ADMIN_SALT", "NEXT_PUBLIC_DEMO_ADMIN_HASH"]) {
    if (env[name] && env[name].length >= 8) forbiddenValues.push({ label: name, value: env[name] });
  }
}

/** Formatos que nunca pertencem ao navegador, em build nenhum. */
const forbiddenPatterns = [
  { label: "chave secreta do gateway", pattern: /\b[sr]k_(test|live)_[A-Za-z0-9]{10,}/ },
  { label: "segredo de webhook", pattern: /\bwhsec_[A-Za-z0-9]{10,}/ },
  { label: "chave privada", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(js|html|txt|json|map)$/.test(entry.name)) yield path;
  }
}

if (!existsSync(OUT)) {
  console.error("out/ nao existe. Rode `npm run build` antes desta checagem.");
  process.exit(1);
}

const findings = [];
let scanned = 0;
let htmlPages = 0;
for await (const path of files(OUT)) {
  scanned += 1;
  const content = await readFile(path, "utf8");
  for (const { label, value } of forbiddenValues) {
    if (content.includes(value)) findings.push(`${path}: ${label}`);
  }
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(content)) findings.push(`${path}: ${label}`);
  }
  // Toda pagina publicada carrega a CSP com o hash dos proprios scripts.
  if (path.endsWith(".html")) {
    htmlPages += 1;
    for (const problem of contentSecurityPolicyProblems(content)) findings.push(`${path}: ${problem}`);
  }
}

if (findings.length > 0) {
  console.error("Valor sensivel no bundle publico:");
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(
  `Bundle publico conferido: ${scanned} arquivos, ${demoBuild ? "build de demonstracao" : "sem verificador demo"}, nenhum segredo, CSP com hash em ${htmlPages} paginas.`,
);
