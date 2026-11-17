import { describe, expect, it } from "vitest";

import { FirestoreWorkspaceRepository } from "./firestore-repository";

/**
 * Caminhos que pertencem ao backend.
 *
 * Classificar mensagem recebida e gravar a decisao da Dara e de
 * `functions/inbound.js`, com o SDK administrativo; as Security Rules negam a
 * criacao de `aiDecisions` pelo cliente. Os dois metodos continuam existindo
 * porque a interface do repositorio e compartilhada com a demonstracao local, e
 * recusam com o motivo em vez de tentar gravar e levar um "permission-denied"
 * que nao explica nada.
 *
 * O teste chama no prototipo de proposito: o construtor liga os listeners do
 * Firestore, e estes dois metodos recusam antes de olhar qualquer estado — nao
 * ha o que construir para prova-los. A prova contra o emulador, com a instancia
 * de verdade, esta em `repository.emulator-test.ts`.
 */
describe("o navegador nao cria decisao da Dara", () => {
  it("recusa gravar decisao, dizendo de quem e o caminho", async () => {
    await expect(
      FirestoreWorkspaceRepository.prototype.recordDecision(),
    ).rejects.toThrow(/backend/);
  });

  it("recusa classificar mensagem recebida", async () => {
    await expect(
      FirestoreWorkspaceRepository.prototype.receiveMessage(),
    ).rejects.toThrow(/backend/);
  });
});
