import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryWorkspaceRepository } from "./memory-repository";
import type { RuleInput } from "../types";

let repo: MemoryWorkspaceRepository;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T15:00:00Z"));
  repo = new MemoryWorkspaceRepository("PSYCHOLOGIST");
  repo.setActor({ userId: "owner", name: "Titular", role: "OWNER" });
});
afterEach(() => vi.useRealTimers());
const conversationId = () =>
  repo
    .getSnapshot()
    .conversations.find(
      (item) => !item.escalated && item.professionalId === "prof-owner",
    )!.id;

describe("fluxos do agente no repositorio", () => {
  it("mensagem administrativa gera uma decisao, resposta vinculada e auditoria", async () => {
    const before = repo.getSnapshot();
    const id = await repo.receiveMessage(
      conversationId(),
      "Qual o valor da consulta?",
    );
    const after = repo.getSnapshot();
    expect(after.decisions).toHaveLength(before.decisions.length + 1);
    expect(after.decisions[0]).toMatchObject({ id, action: "AUTO_RESPONSE" });
    expect(after.messages).toHaveLength(before.messages.length + 2);
    expect(
      after.messages.slice(-2).every((message) => message.aiDecisionId === id),
    ).toBe(true);
    expect(after.auditLogs).toHaveLength(before.auditLogs.length + 1);
    expect(after.decisions.slice(1)).toEqual(before.decisions);
  });
  it("risco gera alerta critico, pausa automacao e preserva CRM", async () => {
    const id = conversationId();
    const before = repo.getSnapshot();
    const decisionId = await repo.receiveMessage(
      id,
      "Nao aguento mais, quero me machucar.",
    );
    const after = repo.getSnapshot();
    expect(after.notifications[0]).toMatchObject({
      aiDecisionId: decisionId,
      priority: "CRITICAL",
      type: "POSSIBLE_RISK_DETECTED",
    });
    expect(after.messages).toHaveLength(before.messages.length + 1);
    expect(after.clients.map((client) => client.administrativeNotes)).toEqual(
      before.clients.map((client) => client.administrativeNotes),
    );
    await repo.receiveMessage(id, "Qual o valor?");
    expect(repo.getSnapshot().decisions[0].action).toBe(
      "ESCALATE_TO_PROFESSIONAL",
    );
    expect(
      repo.getSnapshot().conversations.find((item) => item.id === id)
        ?.attention,
    ).toBe("CRITICAL");
  });
  it("desconhecida aguarda humano; resposta manual nao reativa agente", async () => {
    const id = conversationId();
    await repo.receiveMessage(id, "Abacaxi.");
    expect(repo.getSnapshot().decisions[0].classification).toBe("UNKNOWN");
    await repo.replyToConversation(id, "Podemos conversar.");
    expect(repo.getSnapshot().messages.at(-1)?.authorType).toBe("PROFESSIONAL");
    expect(
      repo.getSnapshot().conversations.find((item) => item.id === id)
        ?.escalated,
    ).toBe(true);
  });
  it("valida e versiona CRUD de regras preservando auditoria", async () => {
    const input = {
      ...repo.getSnapshot().rules.find((rule) => rule.id === "rule-pricing")!,
      name: "Preco personalizado",
    } satisfies RuleInput;
    const id = await repo.createRule(input);
    await repo.updateRule(id, { name: "Preco revisado" });
    await repo.setRuleEnabled(id, false);
    expect(
      repo.getSnapshot().rules.find((rule) => rule.id === id),
    ).toMatchObject({ version: 3, enabled: false });
    await repo.deleteRule(id);
    expect(repo.getSnapshot().rules.some((rule) => rule.id === id)).toBe(false);
    expect(
      repo.getSnapshot().auditLogs.filter((log) => log.resource.id === id),
    ).toHaveLength(4);
    await expect(repo.createRule({ ...input, priority: -1 })).rejects.toThrow();
    await expect(
      repo.createRule({ ...input, professionalId: "outro-tenant-prof" }),
    ).rejects.toThrow();
  });
  it("recusa mutacao de regra imutavel inclusive para OWNER", async () => {
    const rule = repo.getSnapshot().rules.find((rule) => rule.immutable)!;
    await expect(
      repo.updateRule(rule.id, { name: "Modificada" }),
    ).rejects.toThrow();
    await expect(repo.setRuleEnabled(rule.id, false)).rejects.toThrow();
    await expect(repo.deleteRule(rule.id)).rejects.toThrow();
  });
  it("rejeita conversa inexistente e permissao insuficiente sem escrita parcial", async () => {
    const before = repo.getSnapshot();
    await expect(
      repo.receiveMessage("outro-tenant", "Qual o valor?"),
    ).rejects.toThrow();
    expect(repo.getSnapshot()).toBe(before);
    repo.setActor({ userId: "viewer", name: "Leitor", role: "VIEWER" });
    await expect(
      repo.receiveMessage(conversationId(), "Qual o valor?"),
    ).rejects.toThrow();
    await expect(
      repo.updateConversation(conversationId(), { escalated: false }),
    ).rejects.toThrow();
    expect(repo.getSnapshot()).toBe(before);
  });
});
