import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A entrada de mensagens (13.5), sem emulador e sem rede.
 *
 * Esta rota e publica e grava dado de paciente. O que os testes abaixo
 * protegem, um por um: corpo forjado nao vira mensagem; numero de uma clinica
 * nao alcanca outra; reentrega da Meta nao duplica; e mensagem de risco vira
 * alerta para gente, nunca resposta automatica.
 */

const store = vi.hoisted(() => new Map());
const consultas = vi.hoisted(() => ({
  senders: [],
  clients: [],
  rules: [],
  appointments: [],
  transactions: [],
  professionals: [],
}));
// Todo caminho tocado pelo webhook, para provar o que ele NAO alcanca.
const acessos = vi.hoisted(() => []);
const gemini = vi.hoisted(() => ({ generate: vi.fn(), reserve: vi.fn() }));
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: gemini.reserve }));

vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/functions", () => ({ getFunctions: vi.fn() }));
vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("firebase-functions/v2/https", () => ({
  onRequest: (options, handler) => Object.assign(handler, { options }),
}));
vi.mock("firebase-admin/firestore", () => {
  const snapshot = (path) => ({
    id: path.split("/").pop(),
    exists: store.has(path),
    data: () => store.get(path),
  });
  const docsDe = (lista) => ({
    size: lista.length,
    docs: lista.map((entrada) => ({
      id: entrada.id,
      exists: true,
      data: () => entrada,
    })),
  });
  const consulta = (lista) => ({
    where: () => consulta(lista),
    orderBy: () => consulta(lista),
    limit: () => consulta(lista),
    get: async () => docsDe(lista),
  });
  // A fila e lida do proprio armazem: o cancelamento precisa ver o que o
  // webhook acabou de planejar.
  const doArmazem = (path) => ({
    where: () => doArmazem(path),
    orderBy: () => doArmazem(path),
    limit: () => doArmazem(path),
    get: async () =>
      docsDe(
        [...store.entries()]
          .filter(
            ([chave]) =>
              chave.startsWith(`${path}/`) &&
              !chave.slice(path.length + 1).includes("/"),
          )
          .map(([chave, dado]) => ({ ...dado, id: chave.split("/").pop() })),
      ),
  });
  return {
    getFirestore: () => ({
      doc: (path) => {
        acessos.push(path);
        return { path, get: async () => snapshot(path) };
      },
      collection: (path) =>
        (acessos.push(path), false) ||
        path.endsWith("/professionals")
          ? consulta(consultas.professionals)
          : path.endsWith("/automationTasks")
            ? doArmazem(path)
            : path.endsWith("/aiRules")
          ? consulta(consultas.rules)
          : path.endsWith("/appointments")
            ? consulta(consultas.appointments)
            : path.endsWith("/transactions")
              ? consulta(consultas.transactions)
              : consulta(consultas.clients),
      collectionGroup: () => consulta(consultas.senders),
      runTransaction: async (callback) => {
        let writing = false;
        const pending = new Map(store);
        const result = await callback({
          get: async (target) => {
            if (writing)
              throw new Error("Firestore recusa leitura após escrita.");
            return target?.path ? snapshot(target.path) : target.get();
          },
          set: (ref, data, options) => {
            writing = true;
            pending.set(
              ref.path,
              options?.merge ? { ...pending.get(ref.path), ...data } : data,
            );
          },
          create: (ref, data) => {
            writing = true;
            if (pending.has(ref.path))
              throw new Error(`já existe: ${ref.path}`);
            pending.set(ref.path, data);
          },
        });
        store.clear();
        for (const [path, data] of pending) store.set(path, data);
        return result;
      },
    }),
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
      toMillis() {
        return this.date.getTime();
      }
    },
  };
});

const {
  applyHumanEcho,
  applyInboundEvent,
  inboundWebhook,
  verifyMetaSignature,
} = await import("./inbound.js");
const { BRIDGE_SIGNATURE_HEADER, BRIDGE_TIMESTAMP_HEADER } =
  await import("./generated/automation-bridge.js");
const { signBridgeMessage } = await import("./n8n-bridge.js");
const { messagePath, paths } = await import("./generated/paths.js");

const PONTE = "segredo-da-ponte";
const META = "segredo-do-app-da-meta";
const ORG = "org-clinica";
const SENDER_ID = "1236644296208358";
const FROM = "5513999990000";

function sender(patch = {}) {
  return {
    id: "WHATSAPP",
    organizationId: ORG,
    channel: "WHATSAPP",
    providerId: "N8N_BRIDGE",
    providerSenderId: SENDER_ID,
    displayNumber: "+15551876897",
    displayName: "Clínica Fictícia",
    status: "APPROVED",
    mode: "TEST",
    testRecipients: [`+${FROM}`],
    lastReason: "Aprovado na Meta.",
    createdAt: "2026-09-20T10:00:00.000Z",
    createdBy: "operadora",
    updatedAt: "2026-09-20T10:00:00.000Z",
    updatedBy: "operadora",
    ...patch,
  };
}

function evento(patch = {}) {
  return {
    kind: "TEXT",
    providerSenderId: SENDER_ID,
    from: FROM,
    providerMessageId: "wamid.um",
    text: "Bom dia, posso chegar dez minutos atrasado?",
    sentAt: "2026-09-20T12:00:00.000Z",
    ...patch,
  };
}

function corpoDaMeta(message) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: SENDER_ID },
              messages: [
                {
                  from: FROM,
                  id: "wamid.http",
                  timestamp: "1789930800",
                  type: "text",
                  text: { body: "Oi" },
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function pedido(
  corpo,
  {
    ponte = PONTE,
    app = META,
    timestamp = new Date().toISOString(),
    method = "POST",
  } = {},
) {
  const headers = {
    [BRIDGE_TIMESTAMP_HEADER]: timestamp,
    [BRIDGE_SIGNATURE_HEADER]: signBridgeMessage(ponte, timestamp, corpo),
    "x-hub-signature-256": `sha256=${createHmac("sha256", app).update(Buffer.from(corpo, "utf8")).digest("hex")}`,
  };
  return {
    method,
    rawBody: Buffer.from(corpo, "utf8"),
    get: (nome) => headers[nome.toLowerCase()],
  };
}

function resposta() {
  const enviado = { status: null, body: null };
  return {
    enviado,
    status(code) {
      enviado.status = code;
      return this;
    },
    send(body) {
      enviado.body = body;
      return this;
    },
    json(body) {
      enviado.body = body;
      return this;
    },
  };
}

beforeEach(() => {
  store.clear();
  acessos.length = 0;
  consultas.professionals = [];
  consultas.senders = [sender()];
  consultas.clients = [];
  consultas.rules = [];
  consultas.appointments = [];
  consultas.transactions = [];
  process.env.N8N_CALLBACK_SECRET = PONTE;
  process.env.META_APP_SECRET = META;
  store.set(paths.organization(ORG), {
    id: ORG,
    primaryProfession: "PSYCHOLOGIST",
    ownerId: "dono",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("interpretação semântica na entrada", () => {
  function enableGemini() {
    vi.stubEnv("GEMINI_ENABLED", "true");
    vi.stubEnv("GEMINI_ORGANIZATION_IDS", ORG);
    vi.stubEnv("GEMINI_PAID_TIER_CONFIRMED", "true");
    vi.stubEnv("GEMINI_API_KEY", "fake-unit-key");
    gemini.generate.mockReset();
    gemini.reserve.mockReset();
    vi.stubGlobal("fetch", gemini.generate);
  }
  it("grava parecer e metadados uma vez e não consulta novamente na reentrega", async () => {
    enableGemini();
    gemini.generate.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      classification: "POSSIBLE_RISK",
                      confidence: 0.96,
                      intent: "NONE",
                      ambiguous: false,
                    }),
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 250, candidatesTokenCount: 40 },
        }),
    });
    const event = evento({
      text: "Já deixei as cartas de despedida e hoje vou acabar com tudo.",
    });
    await applyInboundEvent(event);
    const decisions = [...store.entries()].filter(([key]) =>
      key.includes("/aiDecisions/"),
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0][1]).toMatchObject({
      classification: "POSSIBLE_RISK",
      attention: "CRITICAL",
      action: "ESCALATE_TO_PROFESSIONAL",
      inputPreview: "",
      classifier: { status: "SUCCEEDED", model: "gemini-3.1-flash-lite" },
    });
    await applyInboundEvent(event);
    expect(gemini.generate).toHaveBeenCalledTimes(1);
  });
  it("falha do Gemini encaminha ao humano, sem resposta automática local", async () => {
    enableGemini();
    gemini.generate.mockRejectedValue(new Error("rede indisponível"));
    await applyInboundEvent(evento({ text: "Qual o valor da consulta?" }));
    const decision = [...store.entries()].find(([key]) =>
      key.includes("/aiDecisions/"),
    )[1];
    expect(decision).toMatchObject({
      classification: "UNKNOWN",
      action: "ESCALATE_TO_PROFESSIONAL",
      classifier: { status: "UNAVAILABLE" },
    });
  });
  it("risco lexical não sai para o provedor", async () => {
    enableGemini();
    await applyInboundEvent(evento({ text: "Quero morrer." }));
    expect(gemini.generate).not.toHaveBeenCalled();
    const decision = [...store.entries()].find(([key]) =>
      key.includes("/aiDecisions/"),
    )[1];
    expect(decision.classifier.status).toBe("LOCAL_GUARD");
    expect(decision.attention).toBe("CRITICAL");
  });
});

describe("as duas assinaturas", () => {
  it("assinatura da Meta confere o corpo bruto", () => {
    const corpo = Buffer.from('{"a":1}', "utf8");
    const certa = `sha256=${createHmac("sha256", META).update(corpo).digest("hex")}`;
    expect(verifyMetaSignature(META, corpo, certa)).toBe(true);
    expect(verifyMetaSignature(META, corpo, certa.replace(/.$/, "0"))).toBe(
      false,
    );
    expect(verifyMetaSignature(META, corpo, "sha1=abc")).toBe(false);
    expect(verifyMetaSignature(META, corpo, undefined)).toBe(false);
    expect(verifyMetaSignature("outro-segredo", corpo, certa)).toBe(false);
  });

  it("sem a assinatura do n8n nao passa — nem com a da Meta correta", async () => {
    const res = resposta();
    await inboundWebhook(pedido(corpoDaMeta({}), { ponte: "errado" }), res);
    expect(res.enviado).toEqual({ status: 401, body: "Assinatura inválida." });
    expect([...store.keys()].some((k) => k.includes("/messages/"))).toBe(false);
  });

  it("sem a assinatura da Meta nao passa — e e isso que impede o n8n de inventar paciente", async () => {
    const res = resposta();
    await inboundWebhook(pedido(corpoDaMeta({}), { app: "errado" }), res);
    expect(res.enviado).toEqual({ status: 401, body: "Assinatura inválida." });
    expect([...store.keys()].some((k) => k.includes("/messages/"))).toBe(false);
  });

  it("repasse capturado fora da janela de 5 minutos nao vale", async () => {
    const res = resposta();
    await inboundWebhook(
      pedido(corpoDaMeta({}), {
        timestamp: new Date(Date.now() - 600_000).toISOString(),
      }),
      res,
    );
    expect(res.enviado.status).toBe(401);
  });

  it("metodo diferente de POST e recusado, e sem segredo a rota diz que nao esta configurada", async () => {
    const semPost = resposta();
    await inboundWebhook(pedido(corpoDaMeta({}), { method: "GET" }), semPost);
    expect(semPost.enviado.status).toBe(405);

    delete process.env.META_APP_SECRET;
    const semSegredo = resposta();
    await inboundWebhook(pedido(corpoDaMeta({})), semSegredo);
    expect(semSegredo.enviado.status).toBe(503);
  });

  it("corpo assinado e aceito vira mensagem gravada", async () => {
    const res = resposta();
    await inboundWebhook(pedido(corpoDaMeta({})), res);
    expect(res.enviado).toMatchObject({ status: 200, body: { received: 1 } });
    expect(
      [...store.keys()].some((k) =>
        k.includes("/conversations/wa-contato-") && k.includes("/messages/"),
      ),
    ).toBe(true);
  });
});

describe("de quem e a mensagem", () => {
  it("modo de teste recusa contato fora da lista e remetente de outro canal", async () => {
    consultas.senders = [sender({ testRecipients: [] })];
    expect(await applyInboundEvent(evento())).toEqual({
      outcome: "TEST_CONTACT_NOT_ALLOWED",
    });
    consultas.senders = [sender({ channel: "EMAIL" })];
    expect(await applyInboundEvent(evento())).toEqual({
      outcome: "UNKNOWN_SENDER",
    });
    expect(store.size).toBe(1);
  });

  it("telefone inválido não cria uma conversa compartilhada sem número", async () => {
    expect(await applyInboundEvent(evento({ from: "inválido" }))).toEqual({
      outcome: "INVALID_PHONE",
    });
    expect(store.size).toBe(1);
  });
  it("numero que nao e de remetente cadastrado nao vira mensagem de ninguem", async () => {
    consultas.senders = [];
    expect(await applyInboundEvent(evento())).toEqual({
      outcome: "UNKNOWN_SENDER",
    });
    expect(store.size).toBe(1);
  });

  it("dois cadastros com o mesmo numero: ninguem recebe, em vez de a clinica errada receber", async () => {
    consultas.senders = [sender(), sender({ organizationId: "outra-clinica" })];
    expect(await applyInboundEvent(evento())).toEqual({
      outcome: "UNKNOWN_SENDER",
    });
  });

  it("remetente ainda nao aprovado nao recebe", async () => {
    consultas.senders = [sender({ status: "PENDING" })];
    expect(await applyInboundEvent(evento())).toEqual({
      outcome: "UNKNOWN_SENDER",
    });
  });

  it("numero desconhecido vira conversa SEM vinculo, e nao e procurado em outra organizacao", async () => {
    const resultado = await applyInboundEvent(evento());

    expect(resultado.organizationId).toBe(ORG);
    expect(resultado.clientId).toBeNull();
    const conversa = store.get(
      paths.document(ORG, "conversations", resultado.conversationId),
    );
    expect(conversa.clientId).toBeNull();
    expect(conversa.clientName).toBe("Contato não identificado");
    // Nenhuma leitura de cliente saiu da organizacao do remetente.
    expect(
      [...store.keys()].every(
        (k) => !k.startsWith("organizations/outra-clinica"),
      ),
    ).toBe(true);
  });
});

describe("o que chega", () => {
  beforeEach(() => {
    consultas.clients = [
      {
        id: "cliente-1",
        organizationId: ORG,
        fullName: "Alex Fictício",
        phone: `+${FROM}`,
        notificationConsent: null,
      },
    ];
  });

  it("persiste mensagem na subcoleção com os campos lidos pelo painel", async () => {
    const result = await applyInboundEvent(evento());
    const message = store.get(
      messagePath(ORG, result.conversationId, "wa-wamid.um"),
    );
    expect(message).toMatchObject({
      readAt: null,
      aiDecisionId: "wa-wamid.um-decision",
      providerMessageId: "wamid.um",
    });
    expect(message.classification).toBe(result.classification);
    expect(message.classificationConfidence).toEqual(expect.any(Number));
    expect(store.has(paths.document(ORG, "messages", "wa-wamid.um"))).toBe(
      false,
    );
  });

  it("eco do app WhatsApp Business assume a conversa e é idempotente", async () => {
    const inbound = await applyInboundEvent(evento());
    const echo = {
      kind: "HUMAN_ECHO",
      providerSenderId: SENDER_ID,
      to: FROM,
      providerMessageId: "wamid.echo",
      text: "Olá, eu assumo daqui.",
      sentAt: "2026-09-20T12:02:00.000Z",
    };

    expect(await applyHumanEcho(echo)).toMatchObject({ outcome: "HUMAN_ECHO" });
    expect(await applyHumanEcho(echo)).toMatchObject({ outcome: "DUPLICATE" });
    expect(
      store.get(paths.document(ORG, "conversations", inbound.conversationId)),
    ).toMatchObject({
      status: "WAITING_CLIENT",
      unreadCount: 0,
      escalated: true,
      escalationReason:
        "Conversa assumida pelo profissional no WhatsApp Business.",
    });
    expect(
      store.get(messagePath(ORG, inbound.conversationId, "wa-wamid.echo")),
    ).toMatchObject({
      direction: "OUTBOUND",
      authorType: "PROFESSIONAL",
      body: "Olá, eu assumo daqui.",
    });
  });

  it("deduplica o formato antigo apenas quando o id original também coincide", async () => {
    store.set(paths.document(ORG, "messages", "wa-wamidum"), {
      providerMessageId: "wamid.um",
    });
    expect(await applyInboundEvent(evento())).toMatchObject({
      outcome: "DUPLICATE",
    });
    expect(
      await applyInboundEvent(evento({ providerMessageId: "wamid.u/m" })),
    ).toMatchObject({ outcome: "CLASSIFIED" });
  });

  it("risco recebido fora de ordem ainda alerta sem substituir o resumo mais recente", async () => {
    await applyInboundEvent(
      evento({
        providerMessageId: "wamid.nova",
        text: "Bom dia",
        sentAt: "2026-09-20T13:00:00.000Z",
      }),
    );
    const result = await applyInboundEvent(
      evento({
        providerMessageId: "wamid.risco",
        text: "não consigo mais, penso em me matar",
      }),
    );
    expect(result).toMatchObject({
      outcome: "OUT_OF_ORDER",
      classification: "POSSIBLE_RISK",
    });
    expect(
      store.get(paths.document(ORG, "conversations", "wa-cliente-1")),
    ).toMatchObject({
      attention: "CRITICAL",
      escalated: true,
      status: "WAITING_PROFESSIONAL",
      lastMessagePreview: "Bom dia",
      unreadCount: 2,
    });
    expect(
      store.get(paths.document(ORG, "notifications", "wa-wamid.risco-alerta")),
    ).toMatchObject({ priority: "CRITICAL" });
  });

  it("uma nova mensagem administrativa não libera a conversa crítica assumida por humano", async () => {
    await applyInboundEvent(
      evento({ text: "não consigo mais, penso em me matar" }),
    );
    await applyInboundEvent(
      evento({
        providerMessageId: "wamid.depois",
        text: "Qual o valor da consulta?",
        sentAt: "2026-09-20T13:00:00.000Z",
      }),
    );
    expect(
      store.get(paths.document(ORG, "conversations", "wa-cliente-1")),
    ).toMatchObject({
      attention: "CRITICAL",
      escalated: true,
      status: "WAITING_PROFESSIONAL",
    });
    expect(
      store.get(paths.document(ORG, "aiDecisions", "wa-wamid.depois-decision"))
        .action,
    ).not.toBe("AUTO_RESPONSE");
  });

  it("SAIR atrasado preserva resumo, janela e canais sem consentimento", async () => {
    consultas.clients[0].notificationConsent = {
      formatVersion: 2,
      channels: { EMAIL: [] },
      legacy: null,
    };
    await applyInboundEvent(
      evento({
        providerMessageId: "wamid.nova",
        text: "Bom dia",
        sentAt: "2026-09-20T13:00:00.000Z",
      }),
    );
    await applyInboundEvent(evento({ text: "SAIR" }));
    expect(
      store.get(paths.document(ORG, "clients", "cliente-1")).notificationConsent
        .channels.EMAIL,
    ).toEqual([]);
    const conversation = store.get(
      paths.document(ORG, "conversations", "wa-cliente-1"),
    );
    expect(conversation.lastMessagePreview).toBe("Bom dia");
    expect(conversation.inboundWindowEndsAt.toDate().toISOString()).toBe(
      "2026-09-21T13:00:00.000Z",
    );
    expect(
      store.get(paths.document(ORG, "auditLogs", "wa-wamid.um-consent")),
    ).toMatchObject({ action: "UPDATE", occurredAt: expect.anything() });
  });

  it("reentrega da Meta nao duplica mensagem nem decisao", async () => {
    await applyInboundEvent(evento());
    const antes = store.size;

    expect(await applyInboundEvent(evento())).toMatchObject({
      outcome: "DUPLICATE",
    });
    expect(store.size).toBe(antes);
  });

  it("mensagem atrasada e gravada, mas nao vira o resumo da conversa", async () => {
    await applyInboundEvent(
      evento({
        providerMessageId: "wamid.nova",
        text: "Mensagem mais nova",
        sentAt: "2026-09-20T13:00:00.000Z",
      }),
    );
    const resultado = await applyInboundEvent(
      evento({
        providerMessageId: "wamid.velha",
        text: "Mensagem atrasada",
        sentAt: "2026-09-20T12:00:00.000Z",
      }),
    );

    expect(resultado.outcome).toBe("OUT_OF_ORDER");
    expect(
      store.get(messagePath(ORG, "wa-cliente-1", "wa-wamid.velha")),
    ).toBeTruthy();
    expect(
      store.get(paths.document(ORG, "conversations", "wa-cliente-1"))
        .lastMessagePreview,
    ).toBe("Mensagem mais nova");
  });

  it("SAIR retira o consentimento do WhatsApp, com registro e pela propria pessoa", async () => {
    consultas.clients = [
      {
        id: "cliente-1",
        organizationId: ORG,
        fullName: "Alex Fictício",
        phone: `+${FROM}`,
        notificationConsent: {
          formatVersion: 2,
          channels: {
            WHATSAPP: [
              {
                granted: {
                  at: "2026-09-01T12:00:00.000Z",
                  recordedBy: {
                    kind: "STAFF",
                    userId: "membro",
                    name: "Equipe",
                  },
                  medium: "FORM",
                },
                textVersion: "v1",
                subjectIsMinor: false,
                legalGuardian: null,
                withdrawn: null,
              },
            ],
            EMAIL: [
              {
                granted: {
                  at: "2026-09-01T12:00:00.000Z",
                  recordedBy: {
                    kind: "STAFF",
                    userId: "membro",
                    name: "Equipe",
                  },
                  medium: "FORM",
                },
                textVersion: "v1",
                subjectIsMinor: false,
                legalGuardian: null,
                withdrawn: null,
              },
            ],
          },
          legacy: null,
        },
      },
    ];

    const resultado = await applyInboundEvent(
      evento({ providerMessageId: "wamid.sair", text: "SAIR" }),
    );

    expect(resultado.outcome).toBe("OPT_OUT");
    const cliente = store.get(paths.document(ORG, "clients", "cliente-1"));
    expect(
      cliente.notificationConsent.channels.WHATSAPP.at(-1).withdrawn,
    ).toMatchObject({
      recordedBy: { kind: "SUBJECT" },
      medium: "MESSAGE",
    });
    // Quem pediu para parar no WhatsApp nao pediu para parar no e-mail.
    expect(
      cliente.notificationConsent.channels.EMAIL.at(-1).withdrawn,
    ).toBeNull();
    expect(
      store.get(paths.document(ORG, "auditLogs", "wa-wamid.sair-consent")),
    ).toBeTruthy();
  });

  it("o botao Confirmar registra que foi a propria pessoa, pelo canal", async () => {
    const resultado = await applyInboundEvent({
      kind: "BUTTON",
      providerSenderId: SENDER_ID,
      from: FROM,
      providerMessageId: "wamid.botao",
      button: "CONFIRM",
      repliedTo: "wamid.lembrete",
      sentAt: "2026-09-20T12:00:00.000Z",
    });

    expect(resultado.outcome).toBe("CONFIRM");
    const registro = store.get(
      paths.document(ORG, "auditLogs", "wa-wamid.botao-confirm"),
    );
    expect(registro.summary).toContain("própria pessoa");
    expect(registro.metadata).toMatchObject({
      channel: "WHATSAPP",
      button: "CONFIRM",
    });
  });

  it("mensagem de risco vira alerta CRITICAL e NUNCA resposta automatica", async () => {
    const resultado = await applyInboundEvent(
      evento({
        providerMessageId: "wamid.risco",
        text: "não consigo mais, penso em me matar",
      }),
    );

    expect(resultado.outcome).toBe("CLASSIFIED");
    expect(resultado.classification).toBe("POSSIBLE_RISK");
    expect(resultado.attention).toBe("CRITICAL");
    expect(resultado.action).not.toBe("AUTO_RESPONSE");

    const alerta = store.get(
      paths.document(ORG, "notifications", "wa-wamid.risco-alerta"),
    );
    expect(alerta).toMatchObject({
      type: "POSSIBLE_RISK_DETECTED",
      priority: "CRITICAL",
      status: "UNREAD",
      channels: ["DASHBOARD"],
      target: { type: "conversation", id: "wa-cliente-1" },
    });
    const decisao = store.get(
      paths.document(ORG, "aiDecisions", "wa-wamid.risco-decision"),
    );
    expect(decisao).toMatchObject({
      classification: "POSSIBLE_RISK",
      responseText: null,
    });
  });

  it("mensagem comum gera decisao registrada, sem alerta critico", async () => {
    const resultado = await applyInboundEvent(
      evento({ providerMessageId: "wamid.comum" }),
    );

    expect(resultado.outcome).toBe("CLASSIFIED");
    expect(
      store.get(paths.document(ORG, "aiDecisions", "wa-wamid.comum-decision")),
    ).toBeTruthy();
    expect(
      store.get(paths.document(ORG, "notifications", "wa-wamid.comum-alerta")),
    ).toMatchObject({ type: "CLIENT_WAITING" });
  });

  it("a janela de 24 horas que a pessoa abriu fica gravada na conversa", async () => {
    const resultado = await applyInboundEvent(
      evento({ providerMessageId: "wamid.janela" }),
    );
    expect(
      store
        .get(paths.document(ORG, "conversations", resultado.conversationId))
        .inboundWindowEndsAt.toDate()
        .toISOString(),
    ).toBe("2026-09-21T12:00:00.000Z");
  });
});

describe("remarcacao pela propria pessoa (13.6)", () => {
  const CONVERSA = "wa-cliente-1";
  const PEDIDO = {
    kind: "BUTTON",
    providerSenderId: SENDER_ID,
    from: FROM,
    providerMessageId: "wamid.remarcar",
    button: "RESCHEDULE",
    repliedTo: "wamid.lembrete",
    sentAt: "2026-09-21T11:00:00.000Z",
  };

  function atendimento(patch = {}) {
    return {
      id: "atendimento-1",
      organizationId: ORG,
      clientId: "cliente-1",
      clientName: "Alex Fictício",
      professionalId: "profissional-1",
      professionalName: "Sam Fictício",
      startsAt: "2026-09-25T13:00:00.000Z",
      endsAt: "2026-09-25T13:50:00.000Z",
      durationMinutes: 50,
      modality: "IN_PERSON",
      status: "SCHEDULED",
      priceInCents: 20000,
      administrativeNotes: null,
      origin: "MANUAL",
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      rescheduledFromId: null,
      externalCalendar: null,
      createdAt: "2026-09-01T12:00:00.000Z",
      createdBy: "membro",
      updatedAt: "2026-09-01T12:00:00.000Z",
      updatedBy: "membro",
      ...patch,
    };
  }

  function organizacao(reschedule) {
    return {
      id: ORG,
      primaryProfession: "PSYCHOLOGIST",
      ownerId: "dono",
      timezone: "America/Sao_Paulo",
      settings: {
        agenda: {
          workingDays: [1, 2, 3, 4, 5],
          workdayStart: "08:00",
          workdayEnd: "12:00",
          slotIntervalMinutes: 30,
          defaultModality: "IN_PERSON",
          allowDoubleBooking: false,
          ...(reschedule ? { reschedule } : {}),
        },
      },
    };
  }

  beforeEach(() => {
    consultas.clients = [
      {
        id: "cliente-1",
        organizationId: ORG,
        fullName: "Alex Fictício",
        phone: `+${FROM}`,
        notificationConsent: null,
      },
    ];
    consultas.appointments = [atendimento()];
    store.set(
      paths.organization(ORG),
      organizacao({
        enabled: true,
        minimumNoticeHours: 24,
        maxReschedulesPerAppointment: 1,
        offeredSlots: 3,
        allowProfessionalChange: false,
        searchWindowDays: 14,
      }),
    );
  });

  it("politica desligada: o pedido vira alerta para a equipe, com o motivo escrito", async () => {
    store.set(paths.organization(ORG), organizacao(null));

    const resultado = await applyInboundEvent(PEDIDO, {
      clock: () => "2026-09-21T11:00:00.000Z",
    });

    expect(resultado.outcome).toBe("RESCHEDULE_ESCALATED");
    expect(resultado.reason).toBe("POLICY_DISABLED");
    const alerta = store.get(
      paths.document(ORG, "notifications", "wa-wamid.remarcar-remarcacao"),
    );
    expect(alerta).toMatchObject({
      priority: "HIGH",
      status: "UNREAD",
      type: "CLIENT_WAITING",
    });
    expect(alerta.body).toContain("não permite remarcação");
    expect(
      store.get(paths.document(ORG, "rescheduleRequests", CONVERSA)),
    ).toBeUndefined();
  });

  it("pedido em cima da hora escala, mesmo com a politica ligada", async () => {
    consultas.appointments = [
      atendimento({
        startsAt: "2026-09-21T13:00:00.000Z",
        endsAt: "2026-09-21T13:50:00.000Z",
      }),
    ];

    const resultado = await applyInboundEvent(PEDIDO, {
      clock: () => "2026-09-21T11:00:00.000Z",
    });

    expect(resultado).toMatchObject({
      outcome: "RESCHEDULE_ESCALATED",
      reason: "TOO_LATE",
    });
  });

  it("dentro da politica, oferece horarios e segura a escolha por poucos minutos", async () => {
    const resultado = await applyInboundEvent(PEDIDO, {
      clock: () => "2026-09-21T11:00:00.000Z",
    });

    expect(resultado.outcome).toBe("RESCHEDULE_OFFERED");
    const pedido = store.get(
      paths.document(ORG, "rescheduleRequests", CONVERSA),
    );
    expect(pedido.status).toBe("OFFERED");
    expect(pedido.slots).toHaveLength(3);
    expect(pedido.appointmentId).toBe("atendimento-1");
    // Gravado como Timestamp, como tudo o que e data no banco.
    expect(pedido.holdEndsAt.toDate().getTime()).toBeGreaterThan(
      Date.parse("2026-09-21T11:00:00.000Z"),
    );
  });

  it("escolher um dos horarios grava o atendimento novo, com trilha", async () => {
    await applyInboundEvent(PEDIDO, {
      clock: () => "2026-09-21T11:00:00.000Z",
    });
    store.set(
      paths.document(ORG, "appointments", "atendimento-1"),
      atendimento(),
    );
    const oferecidos = store.get(
      paths.document(ORG, "rescheduleRequests", CONVERSA),
    ).slots;
    const comoIso = (valor) =>
      typeof valor === "string" ? valor : valor.toDate().toISOString();

    const resultado = await applyInboundEvent(
      {
        ...PEDIDO,
        kind: "TEXT",
        providerMessageId: "wamid.escolha",
        text: "1",
        button: undefined,
      },
      { clock: () => "2026-09-21T11:02:00.000Z" },
    );

    expect(resultado.outcome).toBe("RESCHEDULE_CONFIRMED");
    const gravado = store.get(
      paths.document(ORG, "appointments", "atendimento-1"),
    );
    expect(comoIso(gravado.startsAt)).toBe(comoIso(oferecidos[0].startsAt));
    expect(gravado.status).toBe("SCHEDULED");
    expect(gravado.origin).toBe("CLIENT_SELF_SERVICE");
    expect(
      store.get(paths.document(ORG, "rescheduleRequests", CONVERSA)).status,
    ).toBe("CONFIRMED");
    expect(
      store.get(paths.document(ORG, "auditLogs", "wa-wamid.escolha-remarcado"))
        .summary,
    ).toContain("própria pessoa");
  });

  it("reserva vencida nao confirma: o horario voltou a ser de quem quiser", async () => {
    await applyInboundEvent(PEDIDO, {
      clock: () => "2026-09-21T11:00:00.000Z",
    });
    store.set(
      paths.document(ORG, "appointments", "atendimento-1"),
      atendimento(),
    );

    const resultado = await applyInboundEvent(
      {
        ...PEDIDO,
        kind: "TEXT",
        providerMessageId: "wamid.tarde",
        text: "1",
        button: undefined,
      },
      { clock: () => "2026-09-21T11:30:00.000Z" },
    );

    // Passada a reserva, a escolha nao vale mais e o texto volta a ser texto.
    expect(resultado.outcome).not.toBe("RESCHEDULE_CONFIRMED");
  });

  describe("o que acontece entre a oferta e a escolha", () => {
    const comoIso = (valor) =>
      typeof valor === "string" ? valor : valor.toDate().toISOString();
    const caminho = paths.document(ORG, "appointments", "atendimento-1");

    async function oferecer() {
      await applyInboundEvent(PEDIDO, {
        clock: () => "2026-09-21T11:00:00.000Z",
      });
      store.set(caminho, atendimento());
      return store.get(paths.document(ORG, "rescheduleRequests", CONVERSA))
        .slots;
    }

    function escolher(texto, id, quando = "2026-09-21T11:02:00.000Z") {
      return applyInboundEvent(
        {
          ...PEDIDO,
          kind: "TEXT",
          providerMessageId: id,
          text: texto,
          button: undefined,
          sentAt: quando,
        },
        { clock: () => quando },
      );
    }

    it("horario marcado pela equipe depois da oferta nao e confirmado, e a equipe fica sabendo", async () => {
      const oferecidos = await oferecer();
      // Enquanto a pessoa pensava, a recepcao marcou outra pessoa no 1o horario.
      consultas.appointments.push(
        atendimento({
          id: "atendimento-2",
          clientId: "cliente-2",
          clientName: "Outra Pessoa",
          startsAt: comoIso(oferecidos[0].startsAt),
          endsAt: comoIso(oferecidos[0].endsAt),
        }),
      );

      const resultado = await escolher("1", "wamid.escolha");

      expect(resultado).toMatchObject({
        outcome: "RESCHEDULE_RETRY",
        reason: "SLOT_TAKEN",
      });
      expect(comoIso(store.get(caminho).startsAt)).toBe(
        "2026-09-25T13:00:00.000Z",
      );
      expect(
        store.get(
          paths.document(ORG, "notifications", "wa-wamid.escolha-remarcacao"),
        ),
      ).toMatchObject({ type: "CLIENT_WAITING", priority: "HIGH" });
    });

    it("atendimento cancelado pela equipe depois da oferta nao volta a existir pela escolha", async () => {
      await oferecer();
      store.set(
        caminho,
        atendimento({
          status: "CANCELLED",
          cancelledAt: "2026-09-21T11:01:00.000Z",
          updatedAt: "2026-09-21T11:01:00.000Z",
        }),
      );

      const resultado = await escolher("1", "wamid.escolha");

      expect(resultado).toMatchObject({
        outcome: "RESCHEDULE_ESCALATED",
        reason: "APPOINTMENT_NOT_ACTIVE",
      });
      expect(store.get(caminho).status).toBe("CANCELLED");
      expect(
        store.get(
          paths.document(ORG, "notifications", "wa-wamid.escolha-remarcacao"),
        ),
      ).toBeTruthy();
    });

    it("atendimento mudado pela equipe depois da oferta nao e sobrescrito pela escolha", async () => {
      await oferecer();
      store.set(
        caminho,
        atendimento({
          startsAt: "2026-09-26T13:00:00.000Z",
          endsAt: "2026-09-26T13:50:00.000Z",
          updatedAt: "2026-09-21T11:01:00.000Z",
        }),
      );

      const resultado = await escolher("1", "wamid.escolha");

      expect(resultado).toMatchObject({
        outcome: "RESCHEDULE_ESCALATED",
        reason: "APPOINTMENT_CHANGED",
      });
      expect(comoIso(store.get(caminho).startsAt)).toBe(
        "2026-09-26T13:00:00.000Z",
      );
    });

    it("o limite de remarcacoes da politica conta a remarcacao feita pelo WhatsApp", async () => {
      await oferecer();
      // A opcao 3: a 1 e a 2 ja teriam passado quando chega o segundo pedido.
      expect((await escolher("3", "wamid.escolha")).outcome).toBe(
        "RESCHEDULE_CONFIRMED",
      );
      // A agenda agora devolve o atendimento ja remarcado.
      consultas.appointments = [store.get(caminho)];
      // O horario novo caiu a menos de 24 h; sem antecedencia, so o limite decide.
      store.set(
        paths.organization(ORG),
        organizacao({
          enabled: true,
          minimumNoticeHours: 0,
          maxReschedulesPerAppointment: 1,
          offeredSlots: 3,
          allowProfessionalChange: false,
          searchWindowDays: 14,
        }),
      );

      const segundo = await applyInboundEvent(
        {
          ...PEDIDO,
          providerMessageId: "wamid.remarcar-2",
          sentAt: "2026-09-21T11:20:00.000Z",
        },
        { clock: () => "2026-09-21T11:20:00.000Z" },
      );

      expect(segundo).toMatchObject({
        outcome: "RESCHEDULE_ESCALATED",
        reason: "LIMIT_REACHED",
      });
    });

    it("reentrega da escolha nao remarca duas vezes nem duplica a trilha", async () => {
      await oferecer();
      await escolher("1", "wamid.escolha");
      const depoisDaPrimeira = store.get(caminho);

      const reentrega = await escolher("1", "wamid.escolha");

      expect(reentrega.outcome).toBe("DUPLICATE");
      expect(store.get(caminho)).toEqual(depoisDaPrimeira);
    });

    it("um segundo '1' depois de confirmado vira mensagem para a equipe, nao outra remarcacao", async () => {
      await oferecer();
      await escolher("1", "wamid.escolha");
      const depoisDaPrimeira = store.get(caminho);

      const outra = await escolher(
        "1",
        "wamid.de-novo",
        "2026-09-21T11:03:00.000Z",
      );

      expect(outra.outcome).toBe("CLASSIFIED");
      expect(store.get(caminho)).toEqual(depoisDaPrimeira);
      expect(
        store.get(
          paths.document(ORG, "notifications", "wa-wamid.de-novo-alerta"),
        ),
      ).toMatchObject({ type: "CLIENT_WAITING" });
    });

    it("numero fora da lista oferecida nao remarca e mantem a oferta aberta", async () => {
      await oferecer();

      const resultado = await escolher("7", "wamid.sete");

      expect(resultado.outcome).not.toBe("RESCHEDULE_CONFIRMED");
      expect(comoIso(store.get(caminho).startsAt)).toBe(
        "2026-09-25T13:00:00.000Z",
      );
      expect(
        store.get(paths.document(ORG, "rescheduleRequests", CONVERSA)).status,
      ).toBe("OFFERED");
    });
  });
});

describe("confirmacao, cancelamento e resposta da Dara (piloto simulado)", () => {
  const caminho = paths.document(ORG, "appointments", "atendimento-1");
  const atendimento = {
    id: "atendimento-1",
    organizationId: ORG,
    clientId: "cliente-1",
    clientName: "Alex Fictício",
    professionalId: "profissional-1",
    professionalName: "Sam Fictício",
    startsAt: "2026-09-25T13:00:00.000Z",
    endsAt: "2026-09-25T13:50:00.000Z",
    durationMinutes: 50,
    modality: "IN_PERSON",
    status: "SCHEDULED",
    priceInCents: 20000,
    origin: "MANUAL",
    confirmedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    rescheduledFromId: null,
    updatedAt: "2026-09-01T12:00:00.000Z",
  };

  beforeEach(() => {
    consultas.clients = [
      {
        id: "cliente-1",
        organizationId: ORG,
        fullName: "Alex Fictício",
        phone: `+${FROM}`,
        notificationConsent: null,
      },
    ];
    consultas.appointments = [atendimento];
    store.set(caminho, atendimento);
  });

  const semTarefaDeEnvio = () =>
    [...store.keys()].every((chave) => !chave.includes("automationTasks"));

  it("o botao Confirmar ainda nao mexe na agenda: registra para a equipe conferir", async () => {
    const resultado = await applyInboundEvent({
      kind: "BUTTON",
      providerSenderId: SENDER_ID,
      from: FROM,
      providerMessageId: "wamid.confirmar",
      button: "CONFIRM",
      repliedTo: "wamid.lembrete",
      sentAt: "2026-09-21T11:00:00.000Z",
    });

    expect(resultado.outcome).toBe("CONFIRM");
    expect(store.get(caminho)).toEqual(atendimento);
    expect(
      store.get(paths.document(ORG, "auditLogs", "wa-wamid.confirmar-confirm")),
    ).toBeTruthy();
    expect(semTarefaDeEnvio()).toBe(true);
  });

  it("Confirmar vindo de numero sem cadastro nao registra confirmacao de ninguem", async () => {
    consultas.clients = [];

    await applyInboundEvent({
      kind: "BUTTON",
      providerSenderId: SENDER_ID,
      from: FROM,
      providerMessageId: "wamid.confirmar",
      button: "CONFIRM",
      repliedTo: null,
      sentAt: "2026-09-21T11:00:00.000Z",
    });

    expect(
      store.get(paths.document(ORG, "auditLogs", "wa-wamid.confirmar-confirm")),
    ).toBeUndefined();
  });

  it("pedido de cancelamento por texto nao cancela sozinho: vai para a equipe", async () => {
    const resultado = await applyInboundEvent(
      evento({
        providerMessageId: "wamid.cancelar",
        text: "Oi, preciso cancelar a consulta de quinta",
        sentAt: "2026-09-21T11:00:00.000Z",
      }),
      { clock: () => "2026-09-21T11:00:00.000Z" },
    );

    expect(resultado.outcome).toBe("CLASSIFIED");
    expect(resultado.action).not.toBe("AUTO_RESPONSE");
    expect(store.get(caminho)).toEqual(atendimento);
    expect(
      store.get(
        paths.document(ORG, "notifications", "wa-wamid.cancelar-alerta"),
      ),
    ).toMatchObject({ type: "CLIENT_WAITING", status: "UNREAD" });
    expect(semTarefaDeEnvio()).toBe(true);
  });

  it("a resposta da Dara fica como sugestao registrada; o webhook nao envia nada", async () => {
    const resultado = await applyInboundEvent(
      evento({
        providerMessageId: "wamid.horario",
        text: "Qual o horário de funcionamento?",
      }),
    );

    expect(resultado.action).not.toBe("AUTO_RESPONSE");
    const decisao = store.get(
      paths.document(ORG, "aiDecisions", "wa-wamid.horario-decision"),
    );
    expect(decisao.action).not.toBe("AUTO_RESPONSE");
    expect(semTarefaDeEnvio()).toBe(true);
  });

  it("depois de risco, a conversa segue com gente mesmo que a pessoa peca para remarcar", async () => {
    await applyInboundEvent(
      evento({
        providerMessageId: "wamid.risco",
        text: "não consigo mais, penso em me matar",
        sentAt: "2026-09-21T10:00:00.000Z",
      }),
      { clock: () => "2026-09-21T10:00:00.000Z" },
    );

    await applyInboundEvent(
      evento({
        providerMessageId: "wamid.depois",
        text: "posso remarcar para sexta?",
        sentAt: "2026-09-21T10:05:00.000Z",
      }),
      { clock: () => "2026-09-21T10:05:00.000Z" },
    );

    expect(
      store.get(paths.document(ORG, "conversations", "wa-cliente-1")),
    ).toMatchObject({
      escalated: true,
      attention: "CRITICAL",
      status: "WAITING_PROFESSIONAL",
    });
    expect(store.get(caminho)).toEqual(atendimento);
  });
});

describe("agenda externa na oferta (13.7)", () => {
  it("compromisso pessoal no Google impede oferecer aquele horario", async () => {
    consultas.clients = [
      {
        id: "cliente-1",
        organizationId: ORG,
        fullName: "Alex Fictício",
        phone: `+${FROM}`,
        notificationConsent: null,
      },
    ];
    consultas.appointments = [
      {
        id: "atendimento-1",
        organizationId: ORG,
        clientId: "cliente-1",
        clientName: "Alex Fictício",
        professionalId: "profissional-1",
        professionalName: "Sam Fictício",
        startsAt: "2026-09-25T13:00:00.000Z",
        endsAt: "2026-09-25T13:50:00.000Z",
        durationMinutes: 50,
        modality: "IN_PERSON",
        status: "SCHEDULED",
        priceInCents: 20000,
        administrativeNotes: null,
        origin: "MANUAL",
        confirmedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        rescheduledFromId: null,
        externalCalendar: null,
        createdAt: "2026-09-01T12:00:00.000Z",
        createdBy: "membro",
        updatedAt: "2026-09-01T12:00:00.000Z",
        updatedBy: "membro",
      },
    ];
    store.set(paths.organization(ORG), {
      id: ORG,
      primaryProfession: "PSYCHOLOGIST",
      ownerId: "dono",
      timezone: "America/Sao_Paulo",
      settings: {
        agenda: {
          workingDays: [1, 2, 3, 4, 5],
          workdayStart: "08:00",
          workdayEnd: "12:00",
          slotIntervalMinutes: 30,
          defaultModality: "IN_PERSON",
          allowDoubleBooking: false,
          reschedule: {
            enabled: true,
            minimumNoticeHours: 24,
            maxReschedulesPerAppointment: 1,
            offeredSlots: 3,
            allowProfessionalChange: false,
            searchWindowDays: 14,
          },
        },
      },
    });

    const agora = "2026-09-21T11:00:00.000Z";
    // A manha inteira de 22/09 ocupada na agenda pessoal.
    store.set(paths.document(ORG, "calendarBusyBlocks", "profissional-1"), {
      id: "profissional-1",
      organizationId: ORG,
      professionalId: "profissional-1",
      blocks: [
        {
          startsAt: "2026-09-22T11:00:00.000Z",
          endsAt: "2026-09-22T15:00:00.000Z",
        },
      ],
      readAt: agora,
    });

    const resultado = await applyInboundEvent(
      {
        kind: "BUTTON",
        providerSenderId: SENDER_ID,
        from: FROM,
        providerMessageId: "wamid.externa",
        button: "RESCHEDULE",
        repliedTo: null,
        sentAt: agora,
      },
      { clock: () => agora },
    );

    expect(resultado.outcome).toBe("RESCHEDULE_OFFERED");
    const oferecidos = store.get(
      paths.document(ORG, "rescheduleRequests", "wa-cliente-1"),
    ).slots;
    const comoIso = (valor) =>
      typeof valor === "string" ? valor : valor.toDate().toISOString();
    // Nenhum horario oferecido cai dentro do compromisso pessoal.
    for (const slot of oferecidos) {
      expect(
        comoIso(slot.startsAt) >= "2026-09-22T15:00:00.000Z" ||
          comoIso(slot.startsAt) < "2026-09-22T11:00:00.000Z",
      ).toBe(true);
    }
  });
});

describe("resposta da assistente planejada no webhook", () => {
  const CONVERSA = "wa-cliente-1";
  const REGRAS = [
    "ADMINISTRATIVE_REPLY",
    "SCHEDULE_OFFERED",
    "SCHEDULE_CONFIRMED",
    "SCHEDULE_HANDED_OFF",
    "RESCHEDULE_OFFERED",
    "RESCHEDULE_CONFIRMED",
    "RESCHEDULE_HANDED_OFF",
    "CANCELLATION_CONFIRMED",
    "CANCELLATION_HANDED_OFF",
  ].map((event) => ({
    id: `${event}:WHATSAPP`,
    event,
    channel: "WHATSAPP",
    enabled: true,
    leadMinutes: 0,
    customTemplate: null,
  }));
  const REGISTRO = {
    granted: {
      at: "2026-09-01T12:00:00.000Z",
      recordedBy: { kind: "STAFF", userId: "membro" },
      medium: "FORM",
    },
    textVersion: "2026-10-09-rascunho",
    subjectIsMinor: false,
    legalGuardian: null,
    withdrawn: null,
  };
  const PEDIDO = {
    kind: "BUTTON",
    providerSenderId: SENDER_ID,
    from: FROM,
    providerMessageId: "wamid.remarcar",
    button: "RESCHEDULE",
    repliedTo: "wamid.lembrete",
    sentAt: "2026-09-21T11:00:00.000Z",
  };
  const comoIso = (valor) =>
    typeof valor === "string" ? valor : valor.toDate().toISOString();
  const caminho = (colecao, id) => paths.document(ORG, colecao, id);
  let fila;

  function atendimento(patch = {}) {
    return {
      id: "atendimento-1",
      organizationId: ORG,
      clientId: "cliente-1",
      clientName: "Alex Fictício",
      professionalId: "profissional-1",
      professionalName: "Sam Fictício",
      startsAt: "2026-09-25T13:00:00.000Z",
      endsAt: "2026-09-25T13:50:00.000Z",
      durationMinutes: 50,
      modality: "IN_PERSON",
      status: "SCHEDULED",
      origin: "MANUAL",
      confirmedAt: null,
      rescheduledFromId: null,
      updatedAt: "2026-09-01T12:00:00.000Z",
      ...patch,
    };
  }

  function organizacao({ remarcacao = true } = {}) {
    return {
      id: ORG,
      name: "Consultório Fictício",
      primaryProfession: "PSYCHOLOGIST",
      ownerId: "dono",
      timezone: "America/Sao_Paulo",
      settings: {
        agenda: {
          workingDays: [1, 2, 3, 4, 5],
          workdayStart: "08:00",
          workdayEnd: "12:00",
          slotIntervalMinutes: 30,
          defaultModality: "IN_PERSON",
          allowDoubleBooking: false,
          reschedule: {
            enabled: remarcacao,
            minimumNoticeHours: 24,
            maxReschedulesPerAppointment: 1,
            offeredSlots: 3,
            allowProfessionalChange: false,
            searchWindowDays: 14,
          },
          selfService: {
            bookingEnabled: true,
            cancellationEnabled: true,
            minimumCancellationNoticeHours: 24,
            offeredSlots: 3,
            searchWindowDays: 14,
          },
        },
        notifications: {
          enabled: true,
          verifiedSenderChannels: ["WHATSAPP"],
          rules: REGRAS,
        },
      },
    };
  }

  function cliente(patch = {}) {
    return {
      id: "cliente-1",
      organizationId: ORG,
      fullName: "Alex Fictício",
      preferredName: null,
      preferredModality: "IN_PERSON",
      phone: `+${FROM}`,
      email: null,
      appointmentNotificationsEnabled: true,
      assignedProfessionalIds: ["profissional-1"],
      notificationConsent: {
        formatVersion: 2,
        channels: { WHATSAPP: [REGISTRO] },
        legacy: null,
      },
      ...patch,
    };
  }

  const enqueue = async (payload, opcoes) => {
    fila.push({ payload, ...opcoes });
  };

  function remarcar(patch = {}, quando = "2026-09-21T11:00:00.000Z") {
    return applyInboundEvent(
      { ...PEDIDO, sentAt: quando, ...patch },
      { clock: () => quando, enqueue },
    );
  }

  function escolher(texto, id, quando = "2026-09-21T11:02:00.000Z") {
    return applyInboundEvent(
      {
        ...PEDIDO,
        kind: "TEXT",
        providerMessageId: id,
        text: texto,
        button: undefined,
        sentAt: quando,
      },
      { clock: () => quando, enqueue },
    );
  }

  const tarefas = () =>
    [...store.keys()].filter((chave) => chave.includes("/automationTasks/"));

  beforeEach(() => {
    fila = [];
    consultas.clients = [cliente()];
    consultas.appointments = [atendimento()];
    consultas.transactions = [];
    store.set(paths.organization(ORG), organizacao());
    store.set(caminho("professionals", "profissional-1"), {
      id: "profissional-1",
      organizationId: ORG,
      displayName: "Sam Fictício",
    });
  });

  function regra(category) {
    return {
      id: `regra-${category.toLowerCase()}`,
      organizationId: ORG,
      professionalId: "profissional-1",
      name: `Permitir ${category.toLowerCase()}`,
      description: "Autoriza a jornada pela conversa.",
      level: "PROFESSIONAL",
      category,
      enabled: true,
      priority: 100,
      conditions: {
        combinator: "AND",
        conditions: [
          {
            field: "message.classification",
            operator: "EQUALS",
            value: "ADMINISTRATIVE",
          },
        ],
      },
      actions: [{ type: "ALLOW_TOPIC", payload: { topic: category } }],
      source: "MANUAL",
      immutable: false,
      version: 1,
      naturalLanguageInput: null,
      lastAppliedAt: null,
    };
  }

  it("espera o prazo configurado e o eco humano cancela a resposta administrativa", async () => {
    const quando = "2026-09-21T14:00:00.000Z"; // segunda, 11h em São Paulo
    consultas.rules = [
      {
        id: "regra-preco",
        organizationId: ORG,
        professionalId: "profissional-1",
        name: "Informar preços",
        description: "Autoriza a informação administrativa de preço.",
        level: "PROFESSIONAL",
        category: "PRICING",
        enabled: true,
        priority: 100,
        conditions: {
          combinator: "AND",
          conditions: [
            {
              field: "message.classification",
              operator: "EQUALS",
              value: "ADMINISTRATIVE",
            },
          ],
        },
        actions: [{ type: "ALLOW_TOPIC", payload: { topic: "PRICING" } }],
        source: "MANUAL",
        immutable: false,
        version: 1,
        naturalLanguageInput: null,
        lastAppliedAt: null,
      },
    ];
    const resultado = await applyInboundEvent(
      evento({
        providerMessageId: "wamid.valor",
        text: "Qual o valor da consulta?",
        sentAt: quando,
      }),
      { clock: () => quando, enqueue },
    );

    expect(resultado).toMatchObject({
      outcome: "CLASSIFIED",
      action: "AUTO_RESPONSE",
      reply: "PLANNED",
      replyTrigger: "HUMAN_RESPONSE_TIMEOUT",
    });
    const taskId = "wa-wamid.valor-resposta";
    const task = store.get(caminho("automationTasks", taskId));
    expect(task).toMatchObject({
      event: "ADMINISTRATIVE_REPLY",
      sourceMessageId: "wa-wamid.valor",
      sourceDecisionId: "wa-wamid.valor-decision",
      appointmentId: null,
      professionalId: "profissional-1",
      status: "SCHEDULED",
    });
    expect(comoIso(task.scheduledFor)).toBe("2026-09-21T14:15:00.000Z");
    expect(store.get(caminho("conversations", CONVERSA))).toMatchObject({
      status: "OPEN",
      escalated: false,
      pendingAssistantTaskId: taskId,
    });

    await applyHumanEcho(
      {
        kind: "HUMAN_ECHO",
        providerSenderId: SENDER_ID,
        to: FROM,
        providerMessageId: "wamid.echo-cancela",
        text: "Olá, eu respondo daqui.",
        sentAt: "2026-09-21T14:02:00.000Z",
      },
      { clock: () => "2026-09-21T14:02:00.000Z" },
    );

    expect(store.get(caminho("automationTasks", taskId))).toMatchObject({
      status: "CANCELLED",
      stopReason: "CONVERSATION_WITH_HUMAN",
    });
    expect(store.get(caminho("notificationDeliveries", taskId))).toMatchObject({
      status: "CANCELLED",
    });
    expect(store.get(caminho("conversations", CONVERSA))).toMatchObject({
      escalated: true,
      pendingAssistantTaskId: null,
    });
  });

  it("a oferta planeja a resposta na mesma transação e a põe na fila", async () => {
    const resultado = await remarcar();

    expect(resultado).toMatchObject({
      outcome: "RESCHEDULE_OFFERED",
      reply: "PLANNED",
    });
    expect(resultado.replyTask).toBeUndefined();
    const tarefa = store.get(
      caminho("automationTasks", "wa-wamid.remarcar-resposta"),
    );
    expect(tarefa).toMatchObject({
      type: "SEND_CONVERSATION_REPLY",
      event: "RESCHEDULE_OFFERED",
      replyStage: "REQUEST",
      appointmentId: "atendimento-1",
      clientId: "cliente-1",
      // Posta na fila, a tarefa passa a agendada.
      status: "SCHEDULED",
    });
    // Vence com a reserva da oferta.
    const pedido = store.get(caminho("rescheduleRequests", CONVERSA));
    expect(comoIso(tarefa.expiresAt)).toBe(comoIso(pedido.holdEndsAt));
    expect(
      store.get(
        caminho("notificationDeliveries", "wa-wamid.remarcar-resposta"),
      ),
    ).toMatchObject({
      event: "RESCHEDULE_OFFERED",
      channel: "WHATSAPP",
      templateId: "assistant:RESCHEDULE_OFFERED:REQUEST",
    });
    expect(fila).toHaveLength(1);
    expect(fila[0].payload).toMatchObject({
      version: 2,
      organizationId: ORG,
      taskId: "wa-wamid.remarcar-resposta",
    });
  });

  it("pedido escrito de remarcação entra no mesmo fluxo seguro do botão", async () => {
    const quando = "2026-09-21T11:00:00.000Z";
    consultas.rules = [
      {
        id: "regra-remarcacao",
        organizationId: ORG,
        professionalId: "profissional-1",
        name: "Permitir remarcação",
        description: "Autoriza a jornada de remarcação pela conversa.",
        level: "PROFESSIONAL",
        category: "RESCHEDULING",
        enabled: true,
        priority: 100,
        conditions: {
          combinator: "AND",
          conditions: [
            {
              field: "message.classification",
              operator: "EQUALS",
              value: "ADMINISTRATIVE",
            },
          ],
        },
        actions: [{ type: "ALLOW_TOPIC", payload: { topic: "RESCHEDULING" } }],
        source: "MANUAL",
        immutable: false,
        version: 1,
        naturalLanguageInput: null,
        lastAppliedAt: null,
      },
    ];
    const resultado = await applyInboundEvent(
      {
        ...PEDIDO,
        kind: "TEXT",
        providerMessageId: "wamid.remarcar-texto",
        text: "Quero remarcar meu horário",
        button: undefined,
        sentAt: quando,
      },
      { clock: () => quando, enqueue },
    );

    expect(resultado).toMatchObject({
      outcome: "RESCHEDULE_OFFERED",
      classification: "ADMINISTRATIVE",
      action: "AUTO_RESPONSE",
      reply: "PLANNED",
    });
    expect(store.get(caminho("rescheduleRequests", CONVERSA))).toMatchObject({
      status: "OFFERED",
      appointmentId: "atendimento-1",
    });
    expect(
      store.get(caminho("automationTasks", "wa-wamid.remarcar-texto-resposta")),
    ).toMatchObject({
      event: "RESCHEDULE_OFFERED",
      sourceMessageId: "wa-wamid.remarcar-texto",
      status: "SCHEDULED",
    });
  });

  it("pedido escrito de agendamento oferece vaga e a escolha cria agenda e financeiro atomicamente", async () => {
    consultas.rules = [regra("SCHEDULING")];
    const quando = "2026-09-21T11:00:00.000Z";
    const oferta = await applyInboundEvent(
      {
        ...PEDIDO,
        kind: "TEXT",
        providerMessageId: "wamid.agendar-texto",
        text: "Quero agendar um horário",
        button: undefined,
        sentAt: quando,
      },
      { clock: () => quando, enqueue },
    );

    expect(oferta).toMatchObject({
      outcome: "SCHEDULE_OFFERED",
      classification: "ADMINISTRATIVE",
      action: "AUTO_RESPONSE",
      reply: "PLANNED",
    });
    const pedido = store.get(caminho("bookingRequests", CONVERSA));
    expect(pedido).toMatchObject({
      status: "OFFERED",
      appointmentId: null,
      professionalId: "profissional-1",
      durationMinutes: 50,
      priceInCents: 18000,
    });

    const confirmacao = await escolher("1", "wamid.agendar-escolha");
    expect(confirmacao).toMatchObject({
      outcome: "SCHEDULE_CONFIRMED",
      reply: "PLANNED",
    });
    const appointmentId = "wa-wamid.agendar-escolha-appointment";
    const agendado = store.get(caminho("appointments", appointmentId));
    expect(agendado).toMatchObject({
      id: appointmentId,
      clientId: "cliente-1",
      professionalId: "profissional-1",
      origin: "CLIENT_SELF_SERVICE",
      status: "SCHEDULED",
    });
    expect(comoIso(agendado.startsAt)).toBe(comoIso(pedido.slots[0].startsAt));
    expect(
      store.get(caminho("transactions", "wa-wamid.agendar-escolha-income")),
    ).toMatchObject({
      appointmentId,
      amountInCents: 18000,
      status: "PENDING",
    });
    expect(
      store.get(
        caminho("automationTasks", "wa-wamid.agendar-escolha-resposta"),
      ),
    ).toMatchObject({
      event: "SCHEDULE_CONFIRMED",
      appointmentId,
      status: "SCHEDULED",
    });
  });

  it("horário de agendamento tomado antes da escolha vai para a equipe sem criar cobrança", async () => {
    consultas.rules = [regra("SCHEDULING")];
    const quando = "2026-09-21T11:00:00.000Z";
    await applyInboundEvent(
      {
        ...PEDIDO,
        kind: "TEXT",
        providerMessageId: "wamid.agendar-disputa",
        text: "Quero agendar um horário",
        button: undefined,
        sentAt: quando,
      },
      { clock: () => quando, enqueue },
    );
    const oferecidos = store.get(caminho("bookingRequests", CONVERSA)).slots;
    consultas.appointments.push(
      atendimento({
        id: "atendimento-concorrente",
        clientId: "cliente-2",
        startsAt: comoIso(oferecidos[0].startsAt),
        endsAt: comoIso(oferecidos[0].endsAt),
      }),
    );

    const resultado = await escolher("1", "wamid.agendar-disputa-escolha");

    expect(resultado).toMatchObject({
      outcome: "SCHEDULE_RETRY",
      reason: "SLOT_TAKEN",
      reply: "PLANNED",
    });
    expect(
      store.get(
        caminho("appointments", "wamid.agendar-disputa-escolha-appointment"),
      ),
    ).toBeUndefined();
    expect(
      store.get(
        caminho("transactions", "wamid.agendar-disputa-escolha-income"),
      ),
    ).toBeUndefined();
    expect(
      store.get(
        caminho("automationTasks", "wa-wamid.agendar-disputa-escolha-resposta"),
      ),
    ).toMatchObject({
      event: "SCHEDULE_HANDED_OFF",
      appointmentId: null,
    });
  });

  it("cancelamento escrito encerra o único atendimento e a cobrança ainda pendente", async () => {
    consultas.rules = [regra("CANCELLATION")];
    consultas.transactions = [
      {
        id: "receita-1",
        organizationId: ORG,
        appointmentId: "atendimento-1",
        status: "PENDING",
        amountInCents: 18000,
      },
    ];
    const quando = "2026-09-21T11:00:00.000Z";
    const resultado = await applyInboundEvent(
      {
        ...PEDIDO,
        kind: "TEXT",
        providerMessageId: "wamid.cancelar-texto",
        text: "Quero cancelar meu horário",
        button: undefined,
        sentAt: quando,
      },
      { clock: () => quando, enqueue },
    );

    expect(resultado).toMatchObject({
      outcome: "CANCELLATION_CONFIRMED",
      reply: "PLANNED",
    });
    expect(store.get(caminho("appointments", "atendimento-1"))).toMatchObject({
      status: "CANCELLED",
      origin: "CLIENT_SELF_SERVICE",
      cancelledAt: expect.anything(),
    });
    expect(store.get(caminho("transactions", "receita-1"))).toMatchObject({
      status: "CANCELLED",
    });
  });

  it("cancelamento com pagamento feito vai para a equipe e não altera a agenda", async () => {
    consultas.rules = [regra("CANCELLATION")];
    consultas.transactions = [
      {
        id: "receita-paga",
        organizationId: ORG,
        appointmentId: "atendimento-1",
        status: "PAID",
      },
    ];
    const quando = "2026-09-21T11:00:00.000Z";
    const resultado = await applyInboundEvent(
      {
        ...PEDIDO,
        kind: "TEXT",
        providerMessageId: "wamid.cancelar-pago",
        text: "Preciso cancelar meu horário",
        button: undefined,
        sentAt: quando,
      },
      { clock: () => quando, enqueue },
    );

    expect(resultado).toMatchObject({
      outcome: "CANCELLATION_ESCALATED",
      reason: "FINANCIAL_REVIEW_REQUIRED",
      reply: "PLANNED",
    });
    expect(store.get(caminho("appointments", "atendimento-1"))).toBeUndefined();
    expect(
      store.get(
        caminho("notifications", "wa-wamid.cancelar-pago-cancelamento"),
      ),
    ).toMatchObject({
      priority: "HIGH",
      professionalId: "profissional-1",
    });
  });

  it("a escolha aceita planeja a confirmação", async () => {
    await remarcar();
    store.set(caminho("appointments", "atendimento-1"), atendimento());

    const resultado = await escolher("1", "wamid.escolha");

    expect(resultado).toMatchObject({
      outcome: "RESCHEDULE_CONFIRMED",
      reply: "PLANNED",
    });
    expect(
      store.get(caminho("automationTasks", "wa-wamid.escolha-resposta")),
    ).toMatchObject({
      event: "RESCHEDULE_CONFIRMED",
      replyStage: "CHOICE",
    });
    expect(fila.map((item) => item.payload.taskId)).toEqual([
      "wa-wamid.remarcar-resposta",
      "wa-wamid.escolha-resposta",
    ]);
  });

  it("horário tomado no meio do caminho planeja o encaminhamento, sem nova oferta", async () => {
    await remarcar();
    const oferecidos = store.get(caminho("rescheduleRequests", CONVERSA)).slots;
    store.set(caminho("appointments", "atendimento-1"), atendimento());
    consultas.appointments.push(
      atendimento({
        id: "atendimento-2",
        clientId: "cliente-2",
        startsAt: comoIso(oferecidos[0].startsAt),
        endsAt: comoIso(oferecidos[0].endsAt),
      }),
    );

    const resultado = await escolher("1", "wamid.escolha");

    expect(resultado).toMatchObject({
      outcome: "RESCHEDULE_RETRY",
      reply: "PLANNED",
    });
    expect(
      store.get(caminho("automationTasks", "wa-wamid.escolha-resposta")),
    ).toMatchObject({
      event: "RESCHEDULE_HANDED_OFF",
      replyStage: "CHOICE",
    });
  });

  it("pedido fora da política planeja o aviso de encaminhamento", async () => {
    store.set(paths.organization(ORG), organizacao({ remarcacao: false }));

    const resultado = await remarcar();

    expect(resultado).toMatchObject({
      outcome: "RESCHEDULE_ESCALATED",
      reason: "POLICY_DISABLED",
      reply: "PLANNED",
    });
    expect(
      store.get(caminho("automationTasks", "wa-wamid.remarcar-resposta")),
    ).toMatchObject({
      event: "RESCHEDULE_HANDED_OFF",
      replyStage: "REQUEST",
    });
  });

  it("reentrega do pedido não planeja segunda resposta nem põe na fila de novo", async () => {
    await remarcar();
    const reentrega = await remarcar();

    expect(reentrega.outcome).toBe("DUPLICATE");
    expect(tarefas()).toHaveLength(1);
    expect(fila).toHaveLength(1);
  });

  it("sem consentimento para o WhatsApp, nada é planejado e o motivo volta no resultado", async () => {
    consultas.clients = [
      cliente({
        notificationConsent: { formatVersion: 2, channels: {}, legacy: null },
      }),
    ];

    const resultado = await remarcar();

    expect(resultado).toMatchObject({
      outcome: "RESCHEDULE_OFFERED",
      reply: "CHANNEL_NOT_CONSENTED",
    });
    expect(tarefas()).toHaveLength(0);
    expect(fila).toHaveLength(0);
  });

  it("conversa com a equipe não recebe resposta automática", async () => {
    store.set(caminho("conversations", CONVERSA), {
      id: CONVERSA,
      organizationId: ORG,
      clientId: "cliente-1",
      escalated: true,
      attention: "CRITICAL",
      status: "WAITING_PROFESSIONAL",
      lastMessageAt: "2026-09-21T10:00:00.000Z",
      lastInboundAt: "2026-09-21T10:00:00.000Z",
      unreadCount: 1,
    });

    const resultado = await remarcar();

    expect(resultado.reply).toBe("CONVERSATION_WITH_HUMAN");
    expect(fila).toHaveLength(0);
  });

  it("fila fora do ar não desfaz o pedido: a resposta fica planejada para vencer com alerta", async () => {
    const resultado = await applyInboundEvent(PEDIDO, {
      clock: () => "2026-09-21T11:00:00.000Z",
      enqueue: async () => {
        throw new Error("fila indisponível");
      },
    });

    expect(resultado).toMatchObject({
      outcome: "RESCHEDULE_OFFERED",
      reply: "PLANNED",
    });
    expect(store.get(caminho("rescheduleRequests", CONVERSA)).status).toBe(
      "OFFERED",
    );
    expect(
      store.get(caminho("automationTasks", "wa-wamid.remarcar-resposta"))
        .status,
    ).toBe("PLANNED");
  });

  it("agenda gravada só com a política de remarcação não derruba o webhook: usa o expediente padrão", async () => {
    const parcial = organizacao();
    parcial.settings.agenda = {
      reschedule: parcial.settings.agenda.reschedule,
    };
    store.set(paths.organization(ORG), parcial);

    const resultado = await remarcar();

    expect(resultado).toMatchObject({
      outcome: "RESCHEDULE_OFFERED",
      reply: "PLANNED",
    });
    expect(
      store.get(caminho("rescheduleRequests", CONVERSA)).slots.length,
    ).toBeGreaterThan(0);
  });

  it("regra da resposta desligada: a oferta segue e nenhuma resposta é planejada", async () => {
    const semRespostas = organizacao();
    semRespostas.settings.notifications.rules = REGRAS.map((regra) => ({
      ...regra,
      enabled: false,
    }));
    store.set(paths.organization(ORG), semRespostas);

    const resultado = await remarcar();

    expect(resultado).toMatchObject({
      outcome: "RESCHEDULE_OFFERED",
      reply: "RULE_DISABLED",
    });
    expect(tarefas()).toHaveLength(0);
    expect(fila).toHaveLength(0);
  });
});

const { NOTIFICATION_CONSENT_TEXT_VERSION } = await import(
  "./generated/notifications-config.js"
);

describe("primeiro contato pelo WhatsApp (leads)", () => {
  const OUTRA = "org-outra-clinica";
  const SEGUNDA = "2026-09-21T14:00:00.000Z"; // segunda, 11h em São Paulo
  const REGRAS = ["ADMINISTRATIVE_REPLY"].map((event) => ({
    id: `${event}:WHATSAPP`,
    event,
    channel: "WHATSAPP",
    enabled: true,
    leadMinutes: 0,
    customTemplate: null,
  }));
  const comoIso = (valor) =>
    typeof valor === "string" ? valor : valor.toDate().toISOString();
  let fila;
  const enqueue = async (payload, opcoes) => {
    fila.push({ payload, ...opcoes });
  };

  function organizacao(id = ORG) {
    return {
      id,
      name: "Consultório Fictício",
      primaryProfession: "PSYCHOLOGIST",
      ownerId: "dono",
      timezone: "America/Sao_Paulo",
      settings: {
        notifications: {
          enabled: true,
          verifiedSenderChannels: ["WHATSAPP"],
          rules: REGRAS,
        },
      },
    };
  }

  function regraDePreco(organizationId = ORG) {
    return {
      id: "regra-preco",
      organizationId,
      professionalId: "profissional-1",
      name: "Informar preços",
      description: "Autoriza a informação administrativa de preço.",
      level: "PROFESSIONAL",
      category: "PRICING",
      enabled: true,
      priority: 100,
      conditions: {
        combinator: "AND",
        conditions: [
          {
            field: "message.classification",
            operator: "EQUALS",
            value: "ADMINISTRATIVE",
          },
        ],
      },
      actions: [{ type: "ALLOW_TOPIC", payload: { topic: "PRICING" } }],
      source: "MANUAL",
      immutable: false,
      version: 1,
      naturalLanguageInput: null,
      lastAppliedAt: null,
    };
  }

  function mensagem(texto, id, quando = SEGUNDA) {
    return applyInboundEvent(
      evento({ providerMessageId: id, text: texto, sentAt: quando }),
      { clock: () => quando, enqueue },
    );
  }

  function eco(id, quando) {
    return applyHumanEcho(
      {
        kind: "HUMAN_ECHO",
        providerSenderId: SENDER_ID,
        to: FROM,
        providerMessageId: id,
        text: "Olá, aqui é a equipe.",
        sentAt: quando,
      },
      { clock: () => quando },
    );
  }

  const chaves = (organizationId, colecao) =>
    [...store.keys()].filter((chave) =>
      chave.startsWith(`organizations/${organizationId}/${colecao}/`),
    );
  const leadDe = (organizationId = ORG) => {
    const [chave] = chaves(organizationId, "leads");
    return chave ? store.get(chave) : undefined;
  };
  const tarefas = () => chaves(ORG, "automationTasks");

  async function autorizar(id = "wamid.autorizo", quando = SEGUNDA) {
    return mensagem("Autorizo mensagens pelo WhatsApp", id, quando);
  }

  beforeEach(() => {
    fila = [];
    store.set(paths.organization(ORG), organizacao());
    consultas.rules = [regraDePreco()];
    consultas.professionals = [
      { id: "profissional-1", organizationId: ORG, active: true },
    ];
  });

  it("primeiro contato desconhecido cria um único lead, sem cadastro de cliente", async () => {
    const resultado = await mensagem(
      "Bom dia, queria conhecer o atendimento",
      "wamid.primeiro",
    );

    expect(resultado.clientId).toBeNull();
    expect(resultado.leadId).toMatch(/^lead-[0-9a-f]{32}$/);
    expect(chaves(ORG, "leads")).toHaveLength(1);
    expect(chaves(ORG, "clients")).toHaveLength(0);
    const lead = leadDe();
    expect(lead).toMatchObject({
      id: resultado.leadId,
      organizationId: ORG,
      source: "WHATSAPP",
      conversationId: resultado.conversationId,
      phone: `+${FROM}`,
      contactHint: "***0000",
      professionalId: "profissional-1",
      status: "WAITING_TEAM",
      notificationConsent: null,
    });
    expect(resultado.conversationId).toMatch(/^wa-contato-/);
    // Dado mínimo: nem o texto nem um nome vão para o lead.
    expect(JSON.stringify(lead)).not.toContain("atendimento");
    expect(Object.keys(lead)).not.toContain("fullName");
    expect(
      store.get(paths.document(ORG, "conversations", resultado.conversationId)),
    ).toMatchObject({ leadId: resultado.leadId, clientId: null });
    expect(
      store.get(paths.document(ORG, "auditLogs", "wa-wamid.primeiro-lead")),
    ).toMatchObject({ resource: { type: "lead", id: resultado.leadId } });
    const alerta = store.get(
      paths.document(ORG, "notifications", "wa-wamid.primeiro-alerta"),
    );
    expect(alerta).toMatchObject({
      type: "NEW_LEAD",
      target: { type: "conversation", id: resultado.conversationId },
      channels: ["DASHBOARD"],
    });
    expect(alerta.body).toContain("Sem consentimento vigente");
    expect(alerta.body).not.toContain("atendimento");
  });

  it("webhook repetido não duplica o lead, e a mensagem seguinte usa o mesmo", async () => {
    const primeiro = await mensagem("Oi, tudo bem?", "wamid.oi");
    const antes = store.size;
    expect(await mensagem("Oi, tudo bem?", "wamid.oi")).toMatchObject({
      outcome: "DUPLICATE",
    });
    expect(store.size).toBe(antes);

    const segunda = await mensagem(
      "Vocês atendem online?",
      "wamid.segunda",
      "2026-09-21T14:05:00.000Z",
    );
    expect(chaves(ORG, "leads")).toHaveLength(1);
    expect(segunda).toMatchObject({
      leadId: primeiro.leadId,
      conversationId: primeiro.conversationId,
    });
    const lead = leadDe();
    expect(comoIso(lead.firstContactAt)).toBe(SEGUNDA);
    expect(comoIso(lead.lastContactAt)).toBe("2026-09-21T14:05:00.000Z");
  });

  it("o mesmo telefone em outra organização é outro lead, sem cruzar dados", async () => {
    const daqui = await mensagem("Oi", "wamid.aqui");
    consultas.senders = [
      sender({ organizationId: OUTRA, providerSenderId: SENDER_ID }),
    ];
    store.set(paths.organization(OUTRA), organizacao(OUTRA));
    acessos.length = 0;
    const dela = await mensagem("Oi", "wamid.la");

    expect(dela.organizationId).toBe(OUTRA);
    expect(chaves(ORG, "leads")).toHaveLength(1);
    expect(chaves(OUTRA, "leads")).toHaveLength(1);
    expect(dela.leadId).not.toBe(daqui.leadId);
    expect(dela.conversationId).not.toBe(daqui.conversationId);
    expect(
      acessos.every((caminho) => !caminho.startsWith(`organizations/${ORG}/`)),
    ).toBe(true);
  });

  it("contato conhecido não cria lead, nem depois de ter sido lead", async () => {
    await mensagem("Oi", "wamid.antes");
    const lead = leadDe();
    consultas.clients = [
      {
        id: "cliente-1",
        organizationId: ORG,
        fullName: "Alex Fictício",
        phone: `+${FROM}`,
        assignedProfessionalIds: ["profissional-1"],
        notificationConsent: null,
      },
    ];
    const resultado = await mensagem(
      "Bom dia",
      "wamid.depois",
      "2026-09-21T15:00:00.000Z",
    );

    expect(resultado).toMatchObject({ clientId: "cliente-1" });
    expect(resultado.leadId).toBeUndefined();
    expect(resultado.conversationId).toBe("wa-cliente-1");
    expect(chaves(ORG, "leads")).toHaveLength(1);
    expect(leadDe()).toEqual(lead);
  });

  it("sem consentimento a Dara registra e alerta, mas não responde", async () => {
    const resultado = await mensagem(
      "Qual o valor da consulta?",
      "wamid.valor",
    );

    expect(resultado).toMatchObject({
      outcome: "CLASSIFIED",
      classification: "ADMINISTRATIVE",
      action: "SUGGEST_RESPONSE",
      reply: "MISSING_CONSENT",
      queue: "COMMERCIAL",
      leadStatus: "WAITING_TEAM",
    });
    expect(tarefas()).toHaveLength(0);
    expect(fila).toHaveLength(0);
    expect(
      store.get(paths.document(ORG, "notifications", "wa-wamid.valor-alerta")),
    ).toBeTruthy();
  });

  it("mensagem que não é a frase de autorização não registra consentimento", async () => {
    for (const [texto, id] of [
      ["Oi, quero receber mensagens", "wamid.oi"],
      ["Sim, pode mandar", "wamid.sim"],
      ["aceito", "wamid.aceito"],
    ]) {
      await mensagem(texto, id);
      expect(leadDe().notificationConsent, texto).toBeNull();
    }
  });

  it("consentimento explícito e vigente libera somente a resposta administrativa elegível", async () => {
    expect(await autorizar()).toMatchObject({
      outcome: "LEAD_CONSENT_GRANTED",
    });
    const registro = leadDe().notificationConsent.channels.WHATSAPP.at(-1);
    expect(registro).toMatchObject({
      textVersion: NOTIFICATION_CONSENT_TEXT_VERSION,
      granted: { recordedBy: { kind: "SUBJECT", userId: null }, medium: "MESSAGE" },
      withdrawn: null,
    });
    expect(
      store.get(paths.document(ORG, "auditLogs", "wa-wamid.autorizo-consent")),
    ).toMatchObject({ resource: { type: "lead" } });

    const resposta = await mensagem(
      "Qual o valor da consulta?",
      "wamid.preco",
      "2026-09-21T14:10:00.000Z",
    );
    expect(resposta).toMatchObject({
      action: "AUTO_RESPONSE",
      reply: "PLANNED",
      queue: "COMMERCIAL",
      leadStatus: "WAITING_TEAM",
    });
    const tarefa = store.get(
      paths.document(ORG, "automationTasks", "wa-wamid.preco-resposta"),
    );
    expect(tarefa).toMatchObject({
      event: "ADMINISTRATIVE_REPLY",
      clientId: null,
      leadId: resposta.leadId,
    });
    expect(
      store.get(
        paths.document(ORG, "notificationDeliveries", "wa-wamid.preco-resposta"),
      ),
    ).toMatchObject({ clientId: null, leadId: resposta.leadId, contactHint: "***0000" });

    // Consentimento não abre exceção: risco continua só com gente.
    const risco = await mensagem(
      "não consigo mais, penso em me matar",
      "wamid.risco",
      "2026-09-21T14:20:00.000Z",
    );
    expect(risco).toMatchObject({ classification: "POSSIBLE_RISK" });
    expect(risco.reply).toBeUndefined();
    expect(tarefas()).toHaveLength(1);
  });

  it("consentimento de versão anterior do texto não autoriza a resposta", async () => {
    await autorizar();
    const lead = leadDe();
    const antigo = structuredClone(lead.notificationConsent);
    antigo.channels.WHATSAPP[0].textVersion = "versao-anterior";
    store.set(paths.document(ORG, "leads", lead.id), {
      ...lead,
      notificationConsent: antigo,
    });

    expect(
      await mensagem(
        "Qual o valor da consulta?",
        "wamid.antigo",
        "2026-09-21T14:10:00.000Z",
      ),
    ).toMatchObject({ reply: "CONSENT_TEXT_OUTDATED" });
    expect(tarefas()).toHaveLength(0);
  });

  it("SAIR cancela na hora a resposta pendente e retira o consentimento", async () => {
    await autorizar();
    await mensagem(
      "Qual o valor da consulta?",
      "wamid.preco",
      "2026-09-21T14:10:00.000Z",
    );
    const id = "wa-wamid.preco-resposta";
    expect(
      store.get(paths.document(ORG, "automationTasks", id)).status,
    ).toBe("SCHEDULED");

    const saida = await mensagem(
      "SAIR",
      "wamid.sair",
      "2026-09-21T14:11:00.000Z",
    );

    expect(saida).toMatchObject({ outcome: "OPT_OUT", cancelled: 1 });
    expect(store.get(paths.document(ORG, "automationTasks", id))).toMatchObject({
      status: "CANCELLED",
      stopReason: "CONSENT_REVOKED",
    });
    expect(
      store.get(paths.document(ORG, "notificationDeliveries", id)),
    ).toMatchObject({ status: "CANCELLED" });
    expect(
      leadDe().notificationConsent.channels.WHATSAPP.at(-1).withdrawn,
    ).toMatchObject({ recordedBy: { kind: "SUBJECT" }, medium: "MESSAGE" });
    expect(
      store.get(paths.document(ORG, "conversations", saida.conversationId))
        .pendingAssistantTaskId,
    ).toBeNull();
  });

  it("SAIR de cliente cadastrado também cancela os avisos que esperavam a vez", async () => {
    consultas.clients = [
      {
        id: "cliente-1",
        organizationId: ORG,
        fullName: "Alex Fictício",
        phone: `+${FROM}`,
        assignedProfessionalIds: ["profissional-1"],
        notificationConsent: null,
      },
    ];
    const lembrete = {
      id: "lembrete-1",
      organizationId: ORG,
      type: "SEND_REMINDER",
      status: "SCHEDULED",
      attempt: 1,
      clientId: "cliente-1",
      deliveryId: "lembrete-1",
      history: [],
    };
    store.set(paths.document(ORG, "automationTasks", "lembrete-1"), lembrete);
    store.set(paths.document(ORG, "notificationDeliveries", "lembrete-1"), {
      id: "lembrete-1",
      organizationId: ORG,
      status: "PLANNED",
    });

    const saida = await mensagem("PARAR", "wamid.parar");

    expect(saida).toMatchObject({ outcome: "OPT_OUT", cancelled: 1 });
    expect(
      store.get(paths.document(ORG, "automationTasks", "lembrete-1")),
    ).toMatchObject({ status: "CANCELLED", stopReason: "CONSENT_REVOKED" });
    expect(
      store.get(paths.document(ORG, "notificationDeliveries", "lembrete-1")),
    ).toMatchObject({ status: "CANCELLED" });
  });

  it("resposta humana pelo WhatsApp Business vence a resposta pendente do lead", async () => {
    await autorizar();
    const resposta = await mensagem(
      "Qual o valor da consulta?",
      "wamid.preco",
      "2026-09-21T14:10:00.000Z",
    );

    expect(await eco("wamid.eco", "2026-09-21T14:11:00.000Z")).toMatchObject({
      outcome: "HUMAN_ECHO",
      leadId: resposta.leadId,
    });
    expect(
      store.get(
        paths.document(ORG, "automationTasks", "wa-wamid.preco-resposta"),
      ),
    ).toMatchObject({ status: "CANCELLED", stopReason: "CONVERSATION_WITH_HUMAN" });
    expect(leadDe()).toMatchObject({ status: "TAKEN_OVER" });
    expect(
      store.get(paths.document(ORG, "conversations", resposta.conversationId)),
    ).toMatchObject({
      escalated: true,
      humanTakeoverSource: "WHATSAPP_BUSINESS",
      pendingAssistantTaskId: null,
    });
  });

  it("conversa assumida não é retomada pela Dara, e eco atrasado não volta o resumo", async () => {
    await autorizar();
    await eco("wamid.eco", "2026-09-21T14:05:00.000Z");
    const depois = await mensagem(
      "Qual o valor da consulta?",
      "wamid.depois",
      "2026-09-21T14:10:00.000Z",
    );

    expect(depois.action).not.toBe("AUTO_RESPONSE");
    expect(tarefas()).toHaveLength(0);
    expect(leadDe()).toMatchObject({ status: "TAKEN_OVER" });
    const conversa = () =>
      store.get(paths.document(ORG, "conversations", depois.conversationId));
    expect(conversa()).toMatchObject({
      escalated: true,
      humanTakeoverSource: "WHATSAPP_BUSINESS",
    });

    await eco("wamid.eco-velho", "2026-09-21T14:01:00.000Z");
    expect(conversa()).toMatchObject({
      lastMessagePreview: "Qual o valor da consulta?",
      escalated: true,
    });
    expect(leadDe()).toMatchObject({ status: "TAKEN_OVER" });
  });

  it("mensagem atrasada não retrocede a situação nem a fila do lead", async () => {
    await mensagem(
      "não consigo mais, penso em me matar",
      "wamid.risco",
      "2026-09-21T14:10:00.000Z",
    );
    const depoisDoRisco = leadDe();
    await mensagem(
      "Qual o valor da consulta?",
      "wamid.velha",
      "2026-09-21T14:00:00.000Z",
    );
    expect(leadDe()).toMatchObject({
      status: depoisDoRisco.status,
      queue: "HUMAN_REVIEW",
      routingReason: "POSSIBLE_RISK",
      attention: "CRITICAL",
    });
    expect(comoIso(leadDe().lastContactAt)).toBe("2026-09-21T14:10:00.000Z");
  });

  it("mensagem clínica, ambígua ou de risco só alerta a equipe, mesmo com consentimento", async () => {
    await autorizar();
    const casos = [
      ["não consigo mais, penso em me matar", "wamid.risco", "POSSIBLE_RISK"],
      [
        "Qual o valor da consulta e posso remarcar para sexta?",
        "wamid.ambigua",
        null,
      ],
      [
        "Estou tendo crises de ansiedade, devo aumentar o remédio?",
        "wamid.clinica",
        null,
      ],
    ];
    let minuto = 10;
    for (const [texto, id, motivo] of casos) {
      const quando = `2026-09-21T14:${minuto}:00.000Z`;
      minuto += 5;
      const resultado = await mensagem(texto, id, quando);
      expect(resultado.action, texto).not.toBe("AUTO_RESPONSE");
      expect(resultado.queue, texto).toBe("HUMAN_REVIEW");
      expect(
        store.get(paths.document(ORG, "notifications", `wa-${id}-alerta`)),
        texto,
      ).toBeTruthy();
      const decisao = store.get(
        paths.document(ORG, "aiDecisions", `wa-${id}-decision`),
      );
      expect(decisao.responseText, texto).toBeNull();
      if (motivo) expect(leadDe().routingReason).toBe(motivo);
    }
    expect(tarefas()).toHaveLength(0);
    const alertaDeRisco = store.get(
      paths.document(ORG, "notifications", "wa-wamid.risco-alerta"),
    );
    expect(alertaDeRisco).toMatchObject({
      type: "POSSIBLE_RISK_DETECTED",
      priority: "CRITICAL",
    });
    // O alerta não carrega o que a pessoa escreveu.
    expect(alertaDeRisco.body).not.toContain("matar");
  });

  it("encaminhamento financeiro fica no financeiro da organização e não toca a cobrança da plataforma", async () => {
    acessos.length = 0;
    const resultado = await mensagem(
      "Posso pagar a consulta por pix?",
      "wamid.pix",
    );

    expect(resultado.queue).toBe("TENANT_FINANCE");
    expect(leadDe()).toMatchObject({ queue: "TENANT_FINANCE" });
    expect(acessos.some((caminho) => caminho.startsWith("platform"))).toBe(false);
    expect(
      [...store.keys()].some((chave) => chave.startsWith("platform")),
    ).toBe(false);
  });
});
