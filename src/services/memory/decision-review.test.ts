import { describe, expect, it } from "vitest";

import { MemoryWorkspaceRepository } from "./memory-repository";

/**
 * Revisao das decisoes da Dara na demonstracao: mesma validacao e mesma trilha
 * do Firestore, e a decisao original nunca muda.
 */

function repositoryAs(role: "OWNER" | "ADMIN" | "PROFESSIONAL") {
  const repo = new MemoryWorkspaceRepository("PSYCHOLOGIST");
  repo.setActor({ userId: "u", name: "Teste", role });
  return repo;
}

describe("revisão das decisões na demonstração", () => {
  it("grava a revisão, registra na trilha e não altera a decisão", async () => {
    const repo = repositoryAs("OWNER");
    const before = repo.getSnapshot().decisions[0];
    await repo.reviewDecision(before.id, { verdict: "CORRECT", expectedClassification: null });

    const snapshot = repo.getSnapshot();
    expect(snapshot.decisionReviews).toEqual([
      expect.objectContaining({ id: before.id, decisionId: before.id, verdict: "CORRECT", createdBy: "u" }),
    ]);
    expect(snapshot.decisions[0]).toEqual(before);
    expect(snapshot.auditLogs[0]).toMatchObject({
      action: "CREATE",
      resource: { type: "aiDecisionReview", id: before.id },
      summary: "Classificação da Dara marcada como correta.",
    });
  });

  it("corrigir substitui a revisão, sem duplicar", async () => {
    const repo = repositoryAs("ADMIN");
    const decision = repo.getSnapshot().decisions[0];
    const other = decision.classification === "UNKNOWN" ? "ADMINISTRATIVE" : "UNKNOWN";
    await repo.reviewDecision(decision.id, { verdict: "CORRECT", expectedClassification: null });
    await repo.reviewDecision(decision.id, { verdict: "INCORRECT", expectedClassification: other });

    const reviews = repo.getSnapshot().decisionReviews ?? [];
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ verdict: "INCORRECT", expectedClassification: other });
    expect(repo.getSnapshot().auditLogs[0]).toMatchObject({ action: "UPDATE", metadata: { previousVerdict: "CORRECT" } });
  });

  it("recusa o profissional", async () => {
    const repo = repositoryAs("PROFESSIONAL");
    const decision = repo.getSnapshot().decisions[0];
    await expect(
      repo.reviewDecision(decision.id, { verdict: "CORRECT", expectedClassification: null }),
    ).rejects.toThrow();
    expect(repo.getSnapshot().decisionReviews ?? []).toEqual([]);
  });
});
