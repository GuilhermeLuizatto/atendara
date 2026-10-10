import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "@/config/permissions";

import { MemoryWorkspaceRepository } from "./memory-repository";

/**
 * Primeiro contato e tomada humana na demonstração: as mesmas travas do plano
 * do Firestore, sem rede.
 */

let repo: MemoryWorkspaceRepository;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T15:00:00Z"));
  repo = new MemoryWorkspaceRepository("PSYCHOLOGIST");
  repo.setActor({ userId: "owner", name: "Titular", role: "OWNER" });
});
afterEach(() => vi.useRealTimers());

const leadIn = (status: string) =>
  (repo.getSnapshot().leads ?? []).find((lead) => lead.status === status)!;
const conversationOf = (id: string) =>
  repo.getSnapshot().conversations.find((item) => item.id === id)!;

describe("primeiro contato na demonstração", () => {
  it("assumir o lead assume a conversa e deixa trilha", async () => {
    const lead = leadIn("NEW");
    const before = repo.getSnapshot().auditLogs.length;
    await repo.updateLeadStatus(lead.id, "TAKEN_OVER");

    expect(repo.getSnapshot().leads?.find((item) => item.id === lead.id)).toMatchObject({
      status: "TAKEN_OVER",
      updatedBy: "owner",
    });
    expect(conversationOf(lead.conversationId)).toMatchObject({
      escalated: true,
      humanTakeoverSource: "PANEL",
    });
    expect(repo.getSnapshot().auditLogs).toHaveLength(before + 1);
    expect(repo.getSnapshot().auditLogs[0].resource).toEqual({ type: "lead", id: lead.id });
  });

  it("encerrar não mexe na conversa, e transição fora da tabela é recusada", async () => {
    const lead = leadIn("TAKEN_OVER");
    const conversation = conversationOf(lead.conversationId);
    await repo.updateLeadStatus(lead.id, "CLOSED");
    expect(conversationOf(lead.conversationId)).toEqual(conversation);
    await expect(repo.updateLeadStatus(lead.id, "CLOSED")).rejects.toThrow("não é permitida");
    await expect(repo.updateLeadStatus("nao-existe", "CLOSED")).rejects.toThrow("não encontrado");
  });

  it("quem não tem lead:manage não muda a fila", async () => {
    const lead = leadIn("WAITING_TEAM");
    repo.setActor({ userId: "viewer", name: "Leitor", role: "VIEWER", permissions: permissionsForRole("VIEWER") });
    await expect(repo.updateLeadStatus(lead.id, "TAKEN_OVER")).rejects.toThrow("Sem permissão");
    expect(leadIn("WAITING_TEAM").id).toBe(lead.id);
  });

  it("assumir a conversa pelo painel leva o lead junto", async () => {
    const lead = leadIn("NEW");
    await repo.updateConversation(lead.conversationId, { escalated: true, status: "WAITING_PROFESSIONAL" });
    expect(conversationOf(lead.conversationId)).toMatchObject({ humanTakeoverSource: "PANEL" });
    expect(repo.getSnapshot().leads?.find((item) => item.id === lead.id)?.status).toBe("TAKEN_OVER");
  });

  it("devolver à Dara só pela retomada, com trilha apontada na conversa", async () => {
    const lead = leadIn("WAITING_TEAM");
    await expect(
      repo.updateConversation(lead.conversationId, { escalated: false }),
    ).rejects.toThrow("Retomar automação");

    await repo.resumeConversationAutomation(lead.conversationId);
    const conversation = conversationOf(lead.conversationId);
    const entry = repo.getSnapshot().auditLogs.find((item) => item.id === conversation.automationResumeAuditId);
    expect(conversation).toMatchObject({ escalated: false, status: "OPEN" });
    expect(entry).toMatchObject({
      summary: "Automação retomada pelo profissional.",
      resource: { type: "conversation", id: lead.conversationId },
    });
    await expect(repo.resumeConversationAutomation(lead.conversationId)).rejects.toThrow(
      "já está com a assistente",
    );
  });
});
