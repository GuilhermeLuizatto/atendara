import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import ts from "typescript";

// O backend usa o mesmo contrato de caminhos e enums do aplicativo.
mkdirSync("functions/generated", { recursive: true });
for (const [source, target] of [["src/lib/firebase/paths.ts", "paths"], ["src/types/access.ts", "access"], ["src/types/profession.ts", "profession"]]) {
  const result = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  writeFileSync(`functions/generated/${target}.js`, "// Gerado por scripts/build-functions.mjs.\n" + result.outputText);
}
