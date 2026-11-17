import { describe, expect, it } from "vitest";

import { PLATFORM_COLLECTIONS, paths } from "./paths";

/**
 * O aceite do contrato (E3) e a primeira colecao `platform*` com caminho usado
 * por backend, regras e teste de regras ao mesmo tempo. Errar o caminho aqui
 * nao quebraria nada em silencio: gravaria a prova do aceite num lugar que
 * nenhuma regra protege.
 */
describe("caminho do aceite do contrato", () => {
  it("vive na raiz, fora de organizations/, e e chaveado pela organizacao", () => {
    expect(paths.platformContractAcceptances()).toBe(
      "platformContractAcceptances",
    );
    expect(paths.platformContractAcceptance("org-1")).toBe(
      "platformContractAcceptances/org-1",
    );
    expect(paths.platformContractAcceptance("org-1")).not.toContain(
      "organizations/",
    );
  });

  it("a colecao esta declarada entre as da plataforma", () => {
    expect(PLATFORM_COLLECTIONS.platformContractAcceptances).toBe(
      "platformContractAcceptances",
    );
  });

  it("um documento por organizacao: o mesmo id devolve o mesmo caminho", () => {
    // E o que garante a ideia de "aceite em vigor": dois aceites da mesma
    // organizacao nao viram dois documentos, e o historico fica na trilha.
    expect(paths.platformContractAcceptance("org-1")).toBe(
      paths.platformContractAcceptance("org-1"),
    );
    expect(paths.platformContractAcceptance("org-2")).not.toBe(
      paths.platformContractAcceptance("org-1"),
    );
  });
});
