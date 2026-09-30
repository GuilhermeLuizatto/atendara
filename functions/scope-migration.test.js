import { describe, expect, it } from "vitest";

import {
  applyPlanInMemory,
  planScopeMigration,
  unresolvedScopeMembers,
} from "./scope-migration.js";

const ORG = "org-1";
const doc = (collection, id, data, parentId) => ({ id, path: `organizations/${ORG}/${collection}/${id}`, data, ...(parentId ? { parentId } : {}) });
const professional = (id, extra = {}) => doc("professionals", id, { userId: id, active: true, ...extra });
const member = (id, role, extra = {}) => doc("members", id, { role, status: "ACTIVE", ...extra });

function legacyOrganization() {
  return {
    members: [
      member("owner", "OWNER", { linkedProfessionalIds: [] }),
      member("assistant", "ASSISTANT"),
      member("viewer", "VIEWER", { linkedProfessionalIds: [] }),
    ],
    professionals: [professional("p1")],
    docs: {
      clients: [doc("clients", "c1", { name: "A" })],
      appointments: [doc("appointments", "a1", { clientId: "c1", professionalId: "p1" })],
      conversations: [doc("conversations", "cv1", { clientId: "c1", professionalId: null })],
      messages: [doc("messages", "m1", { conversationId: "cv1", professionalId: null }, "cv1")],
      transactions: [doc("transactions", "t1", { clientId: "c1", appointmentId: "a1", professionalId: null })],
      paymentLinks: [doc("paymentLinks", "t1", { transactionId: "t1", professionalId: null })],
      aiDecisions: [doc("aiDecisions", "d1", { conversationId: "cv1", professionalId: null })],
      aiDecisionReviews: [doc("aiDecisionReviews", "d1", { decisionId: "d1", professionalId: null })],
      aiRules: [doc("aiRules", "r1", { professionalId: null })],
      automationTasks: [doc("automationTasks", "k1", { professionalId: null })],
    },
  };
}

function plan(input, decisions = null) {
  return planScopeMigration({ organizationId: ORG, decisions, ...input });
}

describe("migração 5.5 — organização com um único profissional", () => {
  it("atribui ao único profissional o que não tem escopo e deixa titular e regras globais em paz", () => {
    const result = plan(legacyOrganization());
    expect(result.status).toBe("READY");
    expect(result.manual).toEqual([]);

    const byPath = Object.fromEntries(result.writes.map((write) => [write.path, write.patch]));
    expect(byPath[`organizations/${ORG}/members/assistant`]).toEqual({ linkedProfessionalIds: ["p1"] });
    expect(byPath[`organizations/${ORG}/members/viewer`]).toEqual({ linkedProfessionalIds: ["p1"] });
    expect(byPath[`organizations/${ORG}/members/owner`]).toBeUndefined();
    expect(byPath[`organizations/${ORG}/clients/c1`]).toEqual({ assignedProfessionalIds: ["p1"] });
    expect(byPath[`organizations/${ORG}/conversations/cv1`]).toEqual({ professionalId: "p1" });
    expect(byPath[`organizations/${ORG}/messages/m1`]).toEqual({ professionalId: "p1" });
    expect(byPath[`organizations/${ORG}/transactions/t1`]).toEqual({ professionalId: "p1" });
    expect(byPath[`organizations/${ORG}/paymentLinks/t1`]).toEqual({ professionalId: "p1" });
    expect(byPath[`organizations/${ORG}/aiDecisionReviews/d1`]).toEqual({ professionalId: "p1" });
    expect(byPath[`organizations/${ORG}/automationTasks/k1`]).toEqual({ professionalId: "p1" });
    expect(byPath[`organizations/${ORG}/aiRules/r1`]).toBeUndefined();
  });

  it("nunca escreve em aiDecisions nem em auditLogs (append-only)", () => {
    const result = plan(legacyOrganization());
    expect(result.writes.some((write) => /\/(aiDecisions|auditLogs)\//.test(write.path))).toBe(false);
    expect(result.counts.collections.aiDecisions.total).toBe(1);
  });

  it("conta membros sem escopo antes e depois", () => {
    const result = plan(legacyOrganization());
    expect(result.counts.unresolvedMembersBefore).toBe(2);
    expect(result.counts.unresolvedMembersAfter).toBe(0);
  });

  it("é repetível: aplicar o plano e planejar de novo não gera escritas", () => {
    const input = legacyOrganization();
    const first = plan(input);
    const migrated = applyPlanInMemory(input.docs, input.members, first);
    const second = plan({ ...input, members: migrated.members, docs: migrated.docs });
    expect(second.writes).toEqual([]);
    expect(second.status).toBe("CLEAN");
    expect(second.counts.unresolvedMembersBefore).toBe(0);
  });

  it("não altera papel nem acrescenta campos de marcação", () => {
    const result = plan(legacyOrganization());
    for (const write of result.writes) {
      expect(Object.keys(write.patch)).toHaveLength(1);
      expect(["linkedProfessionalIds", "assignedProfessionalIds", "professionalId"]).toContain(Object.keys(write.patch)[0]);
    }
  });
});

function multiProfessionalOrganization() {
  return {
    members: [
      member("owner", "OWNER"),
      member("p1", "PROFESSIONAL", { linkedProfessionalIds: [] }),
      member("assistant", "ASSISTANT", { linkedProfessionalIds: [] }),
    ],
    professionals: [professional("p1"), professional("p2")],
    docs: {
      clients: [doc("clients", "c1", { name: "A" }), doc("clients", "c2", { name: "B", assignedProfessionalIds: ["p2"] })],
      appointments: [
        doc("appointments", "a1", { clientId: "c1", professionalId: "p1" }),
        doc("appointments", "a2", { clientId: "c2", professionalId: "p2" }),
      ],
      conversations: [doc("conversations", "cv2", { clientId: "c2", professionalId: null })],
      transactions: [doc("transactions", "t2", { clientId: "c2", appointmentId: "a2", professionalId: null })],
      automationTasks: [doc("automationTasks", "k1", { professionalId: null })],
    },
  };
}

describe("migração 5.5 — organização multiprofissional", () => {
  it("liga o profissional ao próprio perfil, mas manda o ambíguo para revisão", () => {
    const result = plan(multiProfessionalOrganization());
    expect(result.status).toBe("NEEDS_REVIEW");

    const byPath = Object.fromEntries(result.writes.map((write) => [write.path, write.patch]));
    expect(byPath[`organizations/${ORG}/members/p1`]).toEqual({ linkedProfessionalIds: ["p1"] });
    expect(byPath[`organizations/${ORG}/members/assistant`]).toBeUndefined();
    expect(result.manual).toContainEqual({ collection: "members", id: "assistant", reason: "AMBIGUOUS_MEMBER_SCOPE", suggestion: null });
    expect(result.counts.unresolvedMembersAfter).toBe(1);
  });

  it("não chuta o cliente: só sugere pelo histórico de agenda", () => {
    const result = plan(multiProfessionalOrganization());
    const pending = result.manual.find((item) => item.collection === "clients" && item.id === "c1");
    expect(pending).toMatchObject({ reason: "AMBIGUOUS_CLIENT_SCOPE", suggestion: { professionalIdsFromAppointments: ["p1"] } });
    expect(result.writes.some((write) => write.path.endsWith("/clients/c1"))).toBe(false);
  });

  it("deriva por evidência do próprio dado, sem palpite", () => {
    const result = plan(multiProfessionalOrganization());
    const byPath = Object.fromEntries(result.writes.map((write) => [write.path, write.patch]));
    expect(byPath[`organizations/${ORG}/conversations/cv2`]).toEqual({ professionalId: "p2" });
    expect(byPath[`organizations/${ORG}/transactions/t2`]).toEqual({ professionalId: "p2" });
  });

  it("tarefa de automação sem evidência fica no nível da organização e não bloqueia", () => {
    const result = plan(multiProfessionalOrganization());
    expect(result.organizationLevel).toContainEqual({ collection: "automationTasks", id: "k1" });
    expect(result.manual.some((item) => item.collection === "automationTasks")).toBe(false);
  });

  it("aplica somente o que o arquivo de decisões determina e libera a organização", () => {
    const input = multiProfessionalOrganization();
    const decisions = {
      members: { assistant: ["p1", "p2"] },
      clients: { c1: ["p1"] },
    };
    const result = plan(input, decisions);
    expect(result.status).toBe("READY");
    expect(result.manual).toEqual([]);
    const byPath = Object.fromEntries(result.writes.map((write) => [write.path, write.patch]));
    expect(byPath[`organizations/${ORG}/members/assistant`]).toEqual({ linkedProfessionalIds: ["p1", "p2"] });
    expect(byPath[`organizations/${ORG}/clients/c1`]).toEqual({ assignedProfessionalIds: ["p1"] });

    const migrated = applyPlanInMemory(input.docs, input.members, result);
    const verification = plan({ ...input, members: migrated.members, docs: migrated.docs }, decisions);
    expect(verification.status).toBe("CLEAN");
    expect(verification.writes).toEqual([]);
  });

  it("decisão que cita profissional inexistente não vira acesso", () => {
    const result = plan(multiProfessionalOrganization(), { members: { assistant: ["fantasma"] }, clients: { c1: ["p1"] } });
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.manual).toContainEqual({ collection: "members", id: "assistant", reason: "DECISION_UNKNOWN_PROFESSIONAL", suggestion: null });
  });

  it("profissional padrão inexistente na decisão é problema, não fallback", () => {
    const result = plan(multiProfessionalOrganization(), { defaultProfessionalId: "fantasma" });
    expect(result.problems).toContainEqual({ code: "DECISION_UNKNOWN_PROFESSIONAL", detail: "defaultProfessionalId" });
    expect(result.status).toBe("NEEDS_REVIEW");
  });

  it("profissional inativo não pode entrar por decisão nem como padrão", () => {
    const input = multiProfessionalOrganization();
    input.professionals.push(professional("inativo", { active: false }));
    const result = plan(input, {
      defaultProfessionalId: "inativo",
      members: { assistant: ["inativo"] },
      clients: { c1: ["inativo"] },
    });
    expect(result.problems).toContainEqual({ code: "DECISION_INACTIVE_PROFESSIONAL", detail: "defaultProfessionalId" });
    expect(result.manual).toContainEqual({ collection: "members", id: "assistant", reason: "DECISION_INACTIVE_PROFESSIONAL", suggestion: null });
    expect(result.manual).toContainEqual({ collection: "clients", id: "c1", reason: "DECISION_INACTIVE_PROFESSIONAL", suggestion: null });
    expect(result.status).toBe("NEEDS_REVIEW");
  });

  it("profissional padrão explícito resolve as pendências e respeita o cliente já associado", () => {
    const result = plan(multiProfessionalOrganization(), { defaultProfessionalId: "p1" });
    const byPath = Object.fromEntries(result.writes.map((write) => [write.path, write.patch]));
    expect(byPath[`organizations/${ORG}/members/assistant`]).toEqual({ linkedProfessionalIds: ["p1"] });
    expect(byPath[`organizations/${ORG}/clients/c1`]).toEqual({ assignedProfessionalIds: ["p1"] });
    // c2 já era de p2: a decisão padrão não sobrescreve nem contamina o que descende dele.
    expect(byPath[`organizations/${ORG}/clients/c2`]).toBeUndefined();
    expect(byPath[`organizations/${ORG}/conversations/cv2`]).toEqual({ professionalId: "p2" });
  });

  it("vínculo existente que aponta para perfil inexistente vai para revisão, não é reescrito", () => {
    const input = multiProfessionalOrganization();
    input.members[2] = member("assistant", "ASSISTANT", { linkedProfessionalIds: ["p1", "removido"] });
    const result = plan(input);
    expect(result.manual).toContainEqual({ collection: "members", id: "assistant", reason: "UNKNOWN_PROFESSIONAL_ID", suggestion: null });
  });

  it("vínculo existente com perfil inativo continua fechado para revisão", () => {
    const input = multiProfessionalOrganization();
    input.professionals.push(professional("inativo", { active: false }));
    input.members[2] = member("assistant", "ASSISTANT", { linkedProfessionalIds: ["inativo"] });
    input.docs.clients[0] = doc("clients", "c1", { assignedProfessionalIds: ["inativo"] });
    const result = plan(input);
    expect(result.manual).toContainEqual({ collection: "members", id: "assistant", reason: "INACTIVE_PROFESSIONAL_ID", suggestion: null });
    expect(result.manual).toContainEqual({ collection: "clients", id: "c1", reason: "INACTIVE_PROFESSIONAL_ID", suggestion: null });
    expect(result.counts.unresolvedMembersAfter).toBe(1);
  });

  it("não liga o membro profissional ao próprio perfil inativo", () => {
    const input = multiProfessionalOrganization();
    input.professionals[0] = professional("p1", { active: false });
    const result = plan(input);
    expect(result.manual).toContainEqual({ collection: "members", id: "p1", reason: "INACTIVE_OWN_PROFILE", suggestion: null });
    expect(result.writes.some((write) => write.path.endsWith("/members/p1"))).toBe(false);
  });
});

describe("unresolvedScopeMembers (trava do piloto)", () => {
  it("ignora OWNER/ADMIN e membros que não estão ativos", () => {
    expect(unresolvedScopeMembers([
      { role: "OWNER", status: "ACTIVE" },
      { role: "ADMIN", status: "ACTIVE", linkedProfessionalIds: [] },
      { role: "ASSISTANT", status: "SUSPENDED" },
      { role: "PROFESSIONAL", status: "INVITED" },
    ])).toEqual([]);
  });

  it("aponta ativo sem lista, com lista vazia ou malformada", () => {
    expect(unresolvedScopeMembers([
      { role: "ASSISTANT", status: "ACTIVE" },
      { role: "PROFESSIONAL", status: "ACTIVE", linkedProfessionalIds: [] },
      { role: "VIEWER", status: "ACTIVE", linkedProfessionalIds: [""] },
      { role: "ASSISTANT", status: "ACTIVE", linkedProfessionalIds: ["p1"] },
    ])).toHaveLength(3);
  });

  it("com a lista de profissionais ativos, vínculo ausente ou inativo também conta", () => {
    const members = [{ role: "ASSISTANT", status: "ACTIVE", linkedProfessionalIds: ["p1", "x"] }];
    expect(unresolvedScopeMembers(members)).toHaveLength(0);
    expect(unresolvedScopeMembers(members, ["p1"])).toHaveLength(1);
  });
});
