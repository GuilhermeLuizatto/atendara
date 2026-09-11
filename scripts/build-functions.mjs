import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import ts from "typescript";

// O backend usa o mesmo contrato de caminhos, enums e politica do aplicativo.
// Transpilar em vez de duplicar e o que impede caminho, catalogo de planos e
// regra de acesso de divergirem entre o navegador e as functions.
const SOURCES = [
  ["src/lib/firebase/paths.ts", "paths"],
  ["src/types/access.ts", "access"],
  ["src/types/profession.ts", "profession"],
  ["src/config/billing.ts", "billing-config"],
  ["src/lib/billing/policy.ts", "billing-policy"],
  ["src/types/platform.ts", "platform-types"],
  ["src/config/platform.ts", "platform-config"],
  ["src/lib/platform/access-gate.ts", "access-gate"],
  ["src/types/privacy.ts", "privacy-types"],
  ["src/config/privacy.ts", "privacy-config"],
  ["src/lib/privacy/redaction.ts", "privacy-redaction"],
];

// As functions nao tem o alias `@/`. Os arquivos acima so importam VALOR uns
// dos outros; qualquer import de valor fora deste mapa quebra o build de
// proposito, em vez de gerar um modulo que so falha em producao.
const ALIASES = {
  "@/config/billing": "./billing-config.js",
  "@/config/platform": "./platform-config.js",
  "@/config/privacy": "./privacy-config.js",
  "@/types/privacy": "./privacy-types.js",
  "@/lib/billing/policy": "./billing-policy.js",
  "@/lib/platform/access-gate": "./access-gate.js",
  "@/types/platform": "./platform-types.js",
  "@/lib/firebase/paths": "./paths.js",
  "@/types/access": "./access.js",
  "@/types/profession": "./profession.js",
};

mkdirSync("functions/generated", { recursive: true });

for (const [source, target] of SOURCES) {
  const result = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  });

  const code = result.outputText.replace(
    /from ["']([^"']+)["']/g,
    (match, specifier) => {
      if (!specifier.startsWith("@/")) return match;
      const mapped = ALIASES[specifier];
      if (!mapped) {
        throw new Error(
          `${source} importa valor de "${specifier}", que nao tem equivalente gerado. Adicione ao mapa ou use "import type".`,
        );
      }
      return `from "${mapped}"`;
    },
  );

  writeFileSync(
    `functions/generated/${target}.js`,
    "// Gerado por scripts/build-functions.mjs.\n" + code,
  );
}
