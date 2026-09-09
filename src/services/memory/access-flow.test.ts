import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryWorkspaceRepository } from "./memory-repository";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Acesso e confirmacao", () => {
  it("confirmar nao cria mensagem, conversa ou resposta de IA", async () => {
    const repo = new MemoryWorkspaceRepository("PSYCHOLOGIST");
    repo.setActor({ userId: "u", name: "Teste", role: "OWNER" });
    const before = repo.getSnapshot();
    await repo.setAppointmentStatus(before.appointments[0].id, "CONFIRMED");
    const after = repo.getSnapshot();
    expect(after.messages).toEqual(before.messages);
    expect(after.conversations).toEqual(before.conversations);
    expect(after.decisions).toEqual(before.decisions);
    expect(after.appointments[0].status).toBe("CONFIRMED");
  });
  it("permissoes explicitas limitam ate um ator com papel OWNER", async () => {
    const repo = new MemoryWorkspaceRepository("PSYCHOLOGIST");
    repo.setActor({ userId: "u", name: "Teste", role: "OWNER", permissions: [] });
    await expect(repo.setAppointmentStatus(repo.getSnapshot().appointments[0].id, "CONFIRMED")).rejects.toThrow("Sem permissao");
  });
  it("isola alteracoes entre contas da mesma profissao", async () => {
    vi.useFakeTimers();
    const stored = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const first = new MemoryWorkspaceRepository("PSYCHOLOGIST", new Date(), "tenant-a");
    first.setActor({ userId: "a", name: "A", role: "OWNER" });
    await first.updateClient(first.getSnapshot().clients[0].id, { fullName: "Exclusivo da conta A" });
    vi.advanceTimersByTime(300);
    const second = new MemoryWorkspaceRepository("PSYCHOLOGIST", new Date(), "tenant-b");
    expect(second.getSnapshot().clients.some(c => c.fullName === "Exclusivo da conta A")).toBe(false);
    expect(new MemoryWorkspaceRepository("PSYCHOLOGIST", new Date(), "tenant-a").getSnapshot().clients[0].fullName).toBe("Exclusivo da conta A");
  });
});
