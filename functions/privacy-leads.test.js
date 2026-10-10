import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pedido de titular que alcança leads, sem emulador: o que a eliminação faz
 * com cada documento ligado ao lead sai do mapa de `src/config/privacy.ts`,
 * e a exportação entrega o lead, a conversa e o que dela deriva. As callables
 * rodam contra um Firestore em memória, com o tenant de outra organização ao
 * lado para provar que o pedido não sai da organização de quem o atende.
 */

const store = vi.hoisted(() => new Map());

vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn() }));
vi.mock("firebase-admin/storage", () => ({ getStorage: vi.fn() }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (options, handler) => Object.assign(handler, { options }),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("./platform.js", () => ({ auditEntry: vi.fn() }));
vi.mock("./platform-auth.js", async (original) => ({
  ...(await original()),
  accountOf: async () => ({
    platformRole: "PROFESSIONAL",
    mustChangePassword: false,
    organizationId: "org-clinica",
    professionId: "PSYCHOLOGIST",
    subscriptionStatus: "ACTIVE",
    accessUntilMs: Date.now() + 86_400_000,
    displayName: "Titular",
  }),
}));
vi.mock("firebase-admin/firestore", () => {
  const read = (data, path) =>
    path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), data);
  const reference = (path) => {
    const parts = path.split("/");
    return {
      path,
      id: parts.at(-1),
      parent: { parent: { id: parts.at(-3) } },
      get: async () => snapshot(path),
    };
  };
  const snapshot = (path) => ({
    id: path.split("/").at(-1),
    ref: reference(path),
    exists: store.has(path),
    data: () => (store.has(path) ? structuredClone(store.get(path)) : undefined),
  });
  const query = (collection, filters = []) => ({
    where: (field, op, value) => query(collection, [...filters, { field, op, value }]),
    get: async () => ({
      docs: [...store.keys()]
        .filter((path) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes("/"))
        .filter((path) =>
          filters.every(({ field, op, value }) => {
            const current = read(store.get(path), field);
            return op === "in" ? value.includes(current) : current === value;
          }),
        )
        .map(snapshot),
    }),
  });
  const patch = (path, changes) => {
    const data = structuredClone(store.get(path));
    for (const [key, value] of Object.entries(changes)) {
      const keys = key.split(".");
      let target = data;
      for (const part of keys.slice(0, -1)) target = target[part] ??= {};
      target[keys.at(-1)] = value;
    }
    store.set(path, data);
  };
  return {
    FieldPath: { documentId: vi.fn() },
    getFirestore: () => ({
      doc: reference,
      collection: (path) => query(path),
      bulkWriter: () => ({
        delete: async (ref) => store.delete(ref.path),
        update: async (ref, changes) => patch(ref.path, changes),
        close: async () => {},
      }),
      batch: () => {
        const writes = [];
        return {
          create: (ref, data) => writes.push(() => store.set(ref.path, data)),
          set: (ref, data) => writes.push(() => store.set(ref.path, data)),
          delete: (ref) => writes.push(() => store.delete(ref.path)),
          commit: async () => writes.forEach((write) => write()),
        };
      },
    }),
  };
});

const { erasureOperations, eraseClientData, eraseLeadData, exportLeadData, leadExportDocument } =
  await import("./privacy.js");
const { PERSONAL_DATA_MAP, REDACTED_TEXT } = await import("./generated/privacy-config.js");
const { ORGANIZATION_EXPORT_SECTIONS } = await import("./generated/privacy-types.js");
const { messagePath, paths } = await import("./generated/paths.js");

const ORG = "org-clinica";
const OUTRA = "org-outra";
const LEAD = "lead-0123456789abcdef0123456789abcdef";
const CONVERSA = "wa-contato-1";
const PSEUDONIMO = "titular-removido-abc";
const PHONE = "+5513999990000";
const em = (colecao, id, org = ORG) => paths.document(org, colecao, id);

/** Documento lido, como o SDK o entrega: ref, id e dados. */
function documento(caminho, dados) {
  const partes = caminho.split("/");
  return {
    id: partes.at(-1),
    ref: { path: caminho, parent: { parent: { id: partes.at(-3) } } },
    data: () => dados,
  };
}

function ligados() {
  return {
    leads: [documento(em("leads", LEAD), { id: LEAD, phone: PHONE, contactHint: "***0000", conversationId: CONVERSA })],
    conversations: [documento(em("conversations", CONVERSA), { leadId: LEAD, clientId: null })],
    messages: [documento(messagePath(ORG, CONVERSA, "wa-wamid.1"), { body: "Qual o valor da consulta?" })],
    aiDecisions: [
      documento(em("aiDecisions", "wa-wamid.1-decision"), {
        conversationId: CONVERSA,
        clientId: null,
        inputPreview: "Qual o valor da consulta?",
        responseText: "O valor está na tabela.",
        classification: "ADMINISTRATIVE",
      }),
    ],
    automationTasks: [documento(em("automationTasks", "wa-wamid.1-resposta"), { clientId: null, leadId: LEAD, status: "CANCELLED" })],
    notificationDeliveries: [
      documento(em("notificationDeliveries", "wa-wamid.1-resposta"), { clientId: null, leadId: LEAD, contactHint: "***0000" }),
    ],
    notifications: [documento(em("notifications", "wa-wamid.1-alerta"), { title: "Novo contato pelo WhatsApp", body: "Encaminhado para Agenda." })],
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

describe("eliminação a pedido de um lead, pelo mapa", () => {
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

  it("o arquivo do lead traz lead, conversa com mensagens e trilha sem nome da equipe", () => {
    const arquivo = leadExportDocument({
      requestId: "pedido-2",
      at: new Date("2026-10-09T12:00:00.000Z"),
      organizationId: ORG,
      organization: { name: "Consultório Fictício" },
      linked: ligados(),
    });
    expect(arquivo).toMatchObject({
      format: "atendara.titular",
      organization: { id: ORG, name: "Consultório Fictício" },
      subject: { id: LEAD, phone: PHONE },
    });
    expect(arquivo.conversations[0].messages).toEqual([{ id: "wa-wamid.1", body: "Qual o valor da consulta?" }]);
    expect(arquivo.auditTrail[0]).toEqual({
      id: "wa-wamid.1-lead",
      action: null,
      occurredAt: null,
      resourceType: "lead",
      summary: "Novo contato pelo WhatsApp registrado como lead.",
    });
  });
});

/** O tenant do teste, com um lead completo, e o mesmo telefone em outra organização. */
function semear(org = ORG) {
  store.set(paths.organization(org), { id: org, name: "Consultório Fictício", primaryProfession: "PSYCHOLOGIST", ownerId: "dono" });
  store.set(em("members", "dono", org), { status: "ACTIVE", role: "OWNER" });
  store.set(em("leads", LEAD, org), { id: LEAD, organizationId: org, phone: PHONE, contactHint: "***0000", conversationId: CONVERSA });
  store.set(em("conversations", CONVERSA, org), { organizationId: org, leadId: LEAD, clientId: null });
  store.set(messagePath(org, CONVERSA, "wa-wamid.1"), { organizationId: org, body: "Qual o valor da consulta?" });
  store.set(em("aiDecisions", "wa-wamid.1-decision", org), {
    organizationId: org,
    conversationId: CONVERSA,
    clientId: null,
    inputPreview: "Qual o valor da consulta?",
    responseText: "O valor está na tabela.",
    classification: "ADMINISTRATIVE",
  });
  store.set(em("automationTasks", "wa-wamid.1-resposta", org), { organizationId: org, clientId: null, leadId: LEAD, status: "CANCELLED" });
  store.set(em("notifications", "wa-wamid.1-alerta", org), {
    organizationId: org,
    title: "Novo contato pelo WhatsApp",
    body: "Encaminhado para Agenda.",
    target: { type: "conversation", id: CONVERSA },
  });
  store.set(em("auditLogs", "wa-wamid.1-lead", org), {
    organizationId: org,
    action: "CREATE",
    resource: { type: "lead", id: LEAD },
    summary: "Novo contato pelo WhatsApp registrado como lead.",
    metadata: { channel: "WHATSAPP" },
  });
}

const pedido = (data) => ({ auth: { uid: "dono", token: {} }, data });
const naOrganizacao = (colecao, org = ORG) =>
  [...store.keys()].filter((path) => path.startsWith(`${paths.collection(org, colecao)}/`));

describe("callables de titular com lead", () => {
  beforeEach(() => {
    store.clear();
    semear();
    semear(OUTRA);
  });

  it("exportação entrega o lead e registra o pedido, sem tocar em nada", async () => {
    const arquivo = await exportLeadData(pedido({ leadId: LEAD, receivedVia: "MESSAGE" }));

    expect(arquivo.subject).toMatchObject({ id: LEAD, phone: PHONE });
    expect(arquivo.conversations[0].messages).toHaveLength(1);
    expect(arquivo.aiDecisions).toHaveLength(1);
    const [registro] = naOrganizacao("privacyRequests").map((path) => store.get(path));
    expect(registro).toMatchObject({ type: "LEAD_EXPORT", subjectId: LEAD, receivedVia: "MESSAGE" });
    expect(store.has(em("leads", LEAD))).toBe(true);
  });

  it("eliminação apaga lead, conversa e mensagens e pseudonimiza a trilha, só nesta organização", async () => {
    const outraAntes = new Map([...store].filter(([path]) => path.startsWith(paths.organization(OUTRA))));
    const { counts } = await eraseLeadData(pedido({ leadId: LEAD, receivedVia: "EMAIL" }));

    expect(counts.leads.deleted).toBe(1);
    expect(store.has(em("leads", LEAD))).toBe(false);
    expect(store.has(em("conversations", CONVERSA))).toBe(false);
    expect(store.has(messagePath(ORG, CONVERSA, "wa-wamid.1"))).toBe(false);

    const decisao = store.get(em("aiDecisions", "wa-wamid.1-decision"));
    expect(decisao).toMatchObject({ inputPreview: REDACTED_TEXT, conversationId: CONVERSA, classification: "ADMINISTRATIVE" });
    const pseudonimo = store.get(em("automationTasks", "wa-wamid.1-resposta")).leadId;
    expect(pseudonimo).toMatch(/^titular-removido-/);
    expect(store.get(em("auditLogs", "wa-wamid.1-lead"))).toMatchObject({
      resource: { type: "lead", id: pseudonimo },
      summary: REDACTED_TEXT,
      privacyRedaction: { scope: "LEAD_ERASURE" },
    });
    expect(store.get(em("notifications", "wa-wamid.1-alerta"))).toMatchObject({ title: REDACTED_TEXT });
    const registro = naOrganizacao("privacyRequests").map((path) => store.get(path)).find((item) => item.type === "LEAD_ERASURE");
    expect(registro).toMatchObject({ subjectId: pseudonimo, receivedVia: "EMAIL" });
    expect(JSON.stringify(registro)).not.toContain(LEAD);

    for (const [path, data] of outraAntes) expect(store.get(path), path).toEqual(data);
  });

  it("lead de outra organização ou inexistente não é encontrado", async () => {
    await expect(eraseLeadData(pedido({ leadId: "lead-que-nao-existe", receivedVia: "EMAIL" }))).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("eliminar o cliente leva junto o lead do mesmo telefone", async () => {
    store.set(em("clients", "cliente-1"), { organizationId: ORG, fullName: "Alex Fictício", phone: "(13) 99999-0000" });

    await eraseClientData(pedido({ clientId: "cliente-1", receivedVia: "IN_PERSON" }));

    expect(store.has(em("clients", "cliente-1"))).toBe(false);
    expect(store.has(em("leads", LEAD))).toBe(false);
    expect(store.has(em("conversations", CONVERSA))).toBe(false);
    expect(store.get(em("automationTasks", "wa-wamid.1-resposta")).leadId).toMatch(/^titular-removido-/);
    expect(store.has(em("leads", LEAD, OUTRA))).toBe(true);
  });
});
