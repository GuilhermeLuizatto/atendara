import { describe, expect, it, vi } from "vitest";

/**
 * Peças do primeiro contato que só o backend tem, sem Firestore: o id do lead,
 * o profissional por contexto, o destinatário relido no envio e o
 * cancelamento do que ainda esperava a vez.
 */

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: class Timestamp {
    constructor(date) {
      this.date = date;
    }
    static fromDate(date) {
      return new Timestamp(date);
    }
    toDate() {
      return this.date;
    }
  },
}));

const {
  cancelPendingAutomation,
  leadIdFor,
  newLeadConversationId,
  replyContactOf,
  soleActiveProfessionalId,
} = await import("./leads.js");
const { grantLeadConsent } = await import("./generated/leads-lifecycle.js");

const AGORA = "2026-10-09T12:00:00.000Z";

/** Transação que lê de um mapa de caminho -> dados. */
function transacao(dados = {}) {
  return {
    get: async (ref) =>
      ref.docs
        ? ref
        : {
            id: ref.path.split("/").pop(),
            exists: ref.path in dados,
            data: () => dados[ref.path],
          },
    set: vi.fn(),
  };
}
const escopo = { doc: (colecao, id) => ({ path: `org/${colecao}/${id}` }) };

describe("identidade do lead", () => {
  it("mesmo telefone na mesma organização é o mesmo lead; em outra, outro", () => {
    expect(leadIdFor("org-a", "+5513999990000")).toBe(leadIdFor("org-a", "+5513999990000"));
    expect(leadIdFor("org-a", "+5513999990000")).not.toBe(leadIdFor("org-b", "+5513999990000"));
    // O id não carrega o telefone.
    expect(leadIdFor("org-a", "+5513999990000")).not.toContain("5513999990000");
  });

  it("a conversa do lead é aleatória", () => {
    expect(newLeadConversationId()).toMatch(/^wa-contato-/);
    expect(newLeadConversationId()).not.toBe(newLeadConversationId());
  });

  it("só escolhe profissional quando há exatamente um ativo", async () => {
    const consulta = (docs) => ({
      collection: () => ({ where: () => ({ limit: () => ({ docs, size: docs.length }) }) }),
    });
    const t = transacao();
    expect(await soleActiveProfessionalId(t, consulta([{ id: "p1" }]), "org")).toBe("p1");
    expect(await soleActiveProfessionalId(t, consulta([{ id: "p1" }, { id: "p2" }]), "org")).toBeNull();
    expect(await soleActiveProfessionalId(t, consulta([]), "org")).toBeNull();
  });
});

describe("destinatário relido no envio", () => {
  const lead = (consentimento) => ({
    id: "lead-1",
    organizationId: "org",
    phone: "+5513999990000",
    conversationId: "wa-contato-1",
    notificationConsent: consentimento,
  });

  it("cadastro: usa o já lido, ou lê, e deduz a conversa do id", async () => {
    const conhecido = { id: "cliente-1" };
    expect(
      await replyContactOf({ transaction: transacao(), scope: escopo, task: { clientId: "cliente-1" }, known: conhecido }),
    ).toEqual({ client: conhecido, conversationId: "wa-cliente-1" });
    const lido = await replyContactOf({
      transaction: transacao({ "org/clients/cliente-1": { fullName: "Alex" } }),
      scope: escopo,
      task: { clientId: "cliente-1" },
    });
    expect(lido.client).toMatchObject({ id: "cliente-1", fullName: "Alex" });
  });

  it("lead com consentimento vigente vira destinatário, na conversa dele", async () => {
    const contato = await replyContactOf({
      transaction: transacao({ "org/leads/lead-1": lead(grantLeadConsent(null, AGORA)) }),
      scope: escopo,
      task: { clientId: null, leadId: "lead-1" },
    });
    expect(contato).toMatchObject({
      client: { id: "lead-1", phone: "+5513999990000", fullName: "" },
      conversationId: "wa-contato-1",
    });
  });

  it("lead sem consentimento, apagado ou ausente não recebe nada", async () => {
    const semConsentimento = await replyContactOf({
      transaction: transacao({ "org/leads/lead-1": lead(null) }),
      scope: escopo,
      task: { clientId: null, leadId: "lead-1" },
    });
    expect(semConsentimento).toEqual({ client: null, conversationId: "wa-contato-1" });
    expect(
      await replyContactOf({ transaction: transacao(), scope: escopo, task: { clientId: null, leadId: "lead-1" } }),
    ).toEqual({ client: null, conversationId: null });
    expect(
      await replyContactOf({ transaction: transacao(), scope: escopo, task: { clientId: null, leadId: null } }),
    ).toEqual({ client: null, conversationId: null });
  });
});

describe("cancelamento do que esperava a vez", () => {
  const tarefa = (id, status) => ({ id, type: "SEND_CONVERSATION_REPLY", status, attempt: 1, maxAttempts: 3, deliveryId: id, history: [] });

  it("cancela planejada e agendada, com a entrega; envio em curso fica", () => {
    const t = transacao();
    const cancelled = cancelPendingAutomation({
      transaction: t,
      scope: escopo,
      tasks: [tarefa("a", "SCHEDULED"), tarefa("b", "PLANNED"), tarefa("c", "DISPATCHING")],
      deliveries: [
        { id: "a", status: "PLANNED" },
        { id: "b", status: "CANCELLED" },
      ],
      now: AGORA,
      code: "CONSENT_REVOKED",
    });
    expect(cancelled).toBe(2);
    const gravados = t.set.mock.calls.map(([ref, data]) => [ref.path, data.status, data.stopReason]);
    expect(gravados).toEqual([
      ["org/automationTasks/a", "CANCELLED", "CONSENT_REVOKED"],
      ["org/notificationDeliveries/a", "CANCELLED", undefined],
      ["org/automationTasks/b", "CANCELLED", "CONSENT_REVOKED"],
    ]);
  });
});
