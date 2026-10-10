import { describe, expect, it, vi } from "vitest";

/**
 * Pedido de titular que alcança leads, sem emulador: o que a eliminação faz
 * com cada documento ligado ao lead sai do mapa de `src/config/privacy.ts`,
 * e a exportação entrega o lead, a conversa e o que dela deriva.
 */

vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn() }));
vi.mock("firebase-admin/storage", () => ({ getStorage: vi.fn() }));
vi.mock("firebase-admin/firestore", () => ({
  FieldPath: { documentId: vi.fn() },
  getFirestore: vi.fn(),
}));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (options, handler) => Object.assign(handler, { options }),
  HttpsError: class HttpsError extends Error {},
}));
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: vi.fn() }));

const { erasureOperations, leadExportDocument } = await import("./privacy.js");
const { PERSONAL_DATA_MAP, REDACTED_TEXT } = await import(
  "./generated/privacy-config.js"
);
const { ORGANIZATION_EXPORT_SECTIONS } = await import(
  "./generated/privacy-types.js"
);

const ORG = "org-clinica";
const LEAD = "lead-0123456789abcdef0123456789abcdef";
const CONVERSA = "wa-contato-1";
const PSEUDONIMO = "titular-removido-abc";

/** Documento lido, como o SDK o entrega: ref, id e dados. */
function documento(caminho, dados) {
  const partes = caminho.split("/");
  return {
    id: partes.at(-1),
    ref: {
      path: caminho,
      parent: { parent: { id: partes.at(-3) } },
    },
    data: () => dados,
  };
}

const em = (colecao, id) => `organizations/${ORG}/${colecao}/${id}`;

function ligados() {
  return {
    leads: [
      documento(em("leads", LEAD), {
        id: LEAD,
        phone: "+5513999990000",
        contactHint: "***0000",
        conversationId: CONVERSA,
      }),
    ],
    conversations: [
      documento(em("conversations", CONVERSA), { leadId: LEAD, clientId: null }),
    ],
    messages: [
      documento(`${em("conversations", CONVERSA)}/messages/wa-wamid.1`, {
        body: "Qual o valor da consulta?",
      }),
    ],
    aiDecisions: [
      documento(em("aiDecisions", "wa-wamid.1-decision"), {
        conversationId: CONVERSA,
        clientId: null,
        inputPreview: "Qual o valor da consulta?",
        responseText: "O valor está na tabela.",
        classification: "ADMINISTRATIVE",
      }),
    ],
    automationTasks: [
      documento(em("automationTasks", "wa-wamid.1-resposta"), {
        clientId: null,
        leadId: LEAD,
        status: "CANCELLED",
      }),
    ],
    notificationDeliveries: [
      documento(em("notificationDeliveries", "wa-wamid.1-resposta"), {
        clientId: null,
        leadId: LEAD,
        contactHint: "***0000",
      }),
    ],
    notifications: [
      documento(em("notifications", "wa-wamid.1-alerta"), {
        title: "Novo contato pelo WhatsApp",
        body: "Encaminhado para Agenda.",
      }),
    ],
    auditLogs: [
      documento(em("auditLogs", "wa-wamid.1-lead"), {
        resource: { type: "lead", id: LEAD },
        summary: "Novo contato pelo WhatsApp registrado como lead.",
        metadata: { channel: "WHATSAPP" },
      }),
      documento(em("auditLogs", "wa-wamid.2-handoff"), {
        resource: { type: "conversation", id: CONVERSA },
        summary: "Resposta humana detectada.",
      }),
    ],
    privacyRequests: [],
  };
}

const contexto = {
  mark: { scope: "LEAD_ERASURE", requestId: "pedido-1", redactedAt: "2026-10-09T12:00:00.000Z" },
  pseudonymOf: (id) => (id === LEAD ? PSEUDONIMO : null),
};

describe("eliminação a pedido de um lead", () => {
  const ordem = ["messages", "conversations", "notificationDeliveries", "automationTasks", "notifications", "aiDecisions", "auditLogs", "privacyRequests", "leads"];
  const operacoes = erasureOperations(ligados(), ordem, contexto);
  const de = (colecao) => operacoes.filter((operacao) => operacao.collection === colecao);

  it("lead, conversa e mensagens saem inteiros", () => {
    for (const colecao of ["leads", "conversations", "messages"]) {
      expect(de(colecao).map((operacao) => operacao.kind), colecao).toEqual(["delete"]);
    }
  });

  it("decisão do agente fica, sem o que a pessoa escreveu e sem perder a trilha", () => {
    const [decisao] = de("aiDecisions");
    expect(decisao.kind).toBe("update");
    expect(decisao.patch).toMatchObject({ inputPreview: REDACTED_TEXT, responseText: REDACTED_TEXT });
    // Campos protegidos da trilha append-only (regra 6) não entram no patch.
    expect(Object.keys(decisao.patch)).not.toContain("conversationId");
    expect(Object.keys(decisao.patch)).not.toContain("classification");
    expect(decisao.patch.privacyRedaction).toMatchObject({ scope: "LEAD_ERASURE", requestId: "pedido-1" });
  });

  it("fila, entrega, alerta e trilha trocam o id do lead pelo pseudônimo", () => {
    expect(de("automationTasks")[0].patch).toMatchObject({ leadId: PSEUDONIMO });
    expect(de("notificationDeliveries")[0].patch).toMatchObject({ leadId: PSEUDONIMO, contactHint: "***" });
    expect(de("notifications")[0].patch).toMatchObject({ title: REDACTED_TEXT, body: REDACTED_TEXT });
    const [doLead, daConversa] = de("auditLogs");
    expect(doLead.patch).toMatchObject({ "resource.id": PSEUDONIMO, summary: REDACTED_TEXT });
    // Conversa aleatória não identifica ninguém: o id fica, o resumo sai.
    expect(daConversa.patch["resource.id"]).toBeUndefined();
    expect(Object.keys(doLead.patch)).not.toContain("metadata");
  });

  it("o mapa decide lead, e a exclusão da organização e a exportação completa o alcançam", () => {
    expect(PERSONAL_DATA_MAP.leads.onClientErasure.action).toBe("DELETE");
    expect(PERSONAL_DATA_MAP.leads.onOrganizationDeletion.action).toBe("DELETE");
    expect(PERSONAL_DATA_MAP.leads.personalFields).toEqual(
      expect.arrayContaining(["phone", "contactHint", "notificationConsent"]),
    );
    expect(ORGANIZATION_EXPORT_SECTIONS).toContain("leads");
  });
});

describe("exportação a pedido de um lead", () => {
  it("entrega lead, conversa com mensagens, decisões e trilha sem nome da equipe", () => {
    const arquivo = leadExportDocument({
      requestId: "pedido-2",
      at: new Date("2026-10-09T12:00:00.000Z"),
      organizationId: ORG,
      organization: { name: "Consultório Fictício" },
      linked: ligados(),
    });
    expect(arquivo).toMatchObject({
      format: "atendara.titular",
      requestId: "pedido-2",
      organization: { id: ORG, name: "Consultório Fictício" },
      subject: { id: LEAD, phone: "+5513999990000" },
    });
    expect(arquivo.conversations[0].messages).toEqual([
      { id: "wa-wamid.1", body: "Qual o valor da consulta?" },
    ]);
    expect(arquivo.aiDecisions).toHaveLength(1);
    expect(arquivo.auditTrail[0]).toEqual({
      id: "wa-wamid.1-lead",
      action: null,
      occurredAt: null,
      resourceType: "lead",
      summary: "Novo contato pelo WhatsApp registrado como lead.",
    });
    expect(JSON.stringify(arquivo.auditTrail)).not.toContain("actorName");
  });
});
