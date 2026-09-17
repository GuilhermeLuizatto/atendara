import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CallableError, callFunction, unsignedIdToken } from "@/lib/testing/emulator-session";

/**
 * H.4 (S-04): nenhuma callable atende sem o atestado do aplicativo.
 *
 * As suites de cada assunto ja provavam a recusa em uma callable cada. Aqui a
 * prova passa por TODAS, e a lista sai do codigo das functions: exportou uma
 * callable nova, ela entra na conferencia sem ninguem lembrar.
 *
 * O token de login e o de uma operadora com segundo fator, para que a recusa
 * nao possa ser atribuida a falta de login. E o contraste fecha a prova: com o
 * atestado, a mesma chamada passa da porta e so falha la dentro, por outro
 * motivo (payload vazio, conta inexistente) — nunca por `unauthenticated`.
 *
 * Rodar com: npm run test:access
 */

const FUNCTIONS_DIR = new URL("../../../functions/", import.meta.url);

function exportedCallables(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(FUNCTIONS_DIR)) {
    if (!file.endsWith(".js") || file.endsWith(".test.js")) continue;
    const source = readFileSync(new URL(file, FUNCTIONS_DIR), "utf8");
    for (const match of source.matchAll(/export const (\w+) = onCall\(/g)) names.add(match[1]);
  }
  return [...names].sort();
}

const CALLABLES = exportedCallables();
// Uid sem documento de conta: se a callable chegasse a rodar, recusaria por
// "cadastro nao liberado", e nao por falta de login.
const idToken = unsignedIdToken("sonda-app-check", "totp");

describe("App Check obrigatorio em toda callable", () => {
  it("encontra as callables no codigo das functions", () => {
    expect(CALLABLES.length).toBeGreaterThanOrEqual(15);
  });

  it.each(CALLABLES)("%s recusa chamada sem atestado, mesmo com login e segundo fator", async (name) => {
    await expect(callFunction(name, {}, { idToken, appCheck: false })).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it.each(CALLABLES)("%s, com atestado, passa da porta e falha por outro motivo", async (name) => {
    const outcome = await callFunction(name, {}, { idToken }).then(
      () => "ok",
      (error: unknown) => (error instanceof CallableError ? error.code : "erro-inesperado"),
    );
    expect(outcome).not.toBe("unauthenticated");
    expect(outcome).not.toBe("erro-inesperado");
  });
});
