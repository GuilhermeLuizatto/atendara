import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A entrada de mensagens (13.5), sem emulador e sem rede.
 *
 * Esta rota e publica e grava dado de paciente. O que os testes abaixo
 * protegem, um por um: corpo forjado nao vira mensagem; numero de uma clinica
 * nao alcanca outra; reentrega da Meta nao duplica; e mensagem de risco vira
 * alerta para gente, nunca resposta automatica.
 */

const store = vi.hoisted(() => new Map());
const consultas = vi.hoisted(() => ({ senders: [], clients: [], rules: [] }));

vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/functions", () => ({ getFunctions: vi.fn() }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/https", () => ({ onRequest: (options, handler) => Object.assign(handler, { options }) }));
vi.mock("firebase-admin/firestore", () => {
  const snapshot = (path) => ({ id: path.split("/").pop(), exists: store.has(path), data: () => store.get(path) });
  const docsDe = (lista) => ({
    size: lista.length,
    docs: lista.map((entrada) => ({ id: entrada.id, exists: true, data: () => entrada })),
  });
  const consulta = (lista) => ({ where: () => consulta(lista), limit: () => consulta(lista), get: async () => docsDe(lista) });
  const transaction = {
    get: async (alvo) => (alvo?.path ? snapshot(alvo.path) : alvo.get()),
    set: (ref, data) => store.set(ref.path, data),
    create: (ref, data) => {
      if (store.has(ref.path)) throw new Error(`ja existe: ${ref.path}`);
      store.set(ref.path, data);
    },
  };
  return {
    getFirestore: () => ({
      doc: (path) => ({ path, get: async () => snapshot(path) }),
      collection: (path) => (path.endsWith("/aiRules") ? consulta(consultas.rules) : consulta(consultas.clients)),
      collectionGroup: () => consulta(consultas.senders),
      runTransaction: async (callback) => callback(transaction),
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

const { applyInboundEvent, inboundWebhook, verifyMetaSignature } = await import("./inbound.js");
const { BRIDGE_SIGNATURE_HEADER, BRIDGE_TIMESTAMP_HEADER } = await import("./generated/automation-bridge.js");
const { signBridgeMessage } = await import("./n8n-bridge.js");
const { paths } = await import("./generated/paths.js");

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
              messages: [{ from: FROM, id: "wamid.http", timestamp: "1789930800", type: "text", text: { body: "Oi" }, ...message }],
            },
          },
        ],
      },
    ],
  });
}

function pedido(corpo, { ponte = PONTE, app = META, timestamp = new Date().toISOString(), method = "POST" } = {}) {
  const headers = {
    [BRIDGE_TIMESTAMP_HEADER]: timestamp,
    [BRIDGE_SIGNATURE_HEADER]: signBridgeMessage(ponte, timestamp, corpo),
    "x-hub-signature-256": `sha256=${createHmac("sha256", app).update(Buffer.from(corpo, "utf8")).digest("hex")}`,
  };
  return { method, rawBody: Buffer.from(corpo, "utf8"), get: (nome) => headers[nome.toLowerCase()] };
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
  consultas.senders = [sender()];
  consultas.clients = [];
  consultas.rules = [];
  process.env.N8N_CALLBACK_SECRET = PONTE;
  process.env.META_APP_SECRET = META;
  store.set(paths.organization(ORG), { id: ORG, primaryProfession: "PSYCHOLOGIST", ownerId: "dono" });
});

describe("as duas assinaturas", () => {
  it("assinatura da Meta confere o corpo bruto", () => {
    const corpo = Buffer.from('{"a":1}', "utf8");
    const certa = `sha256=${createHmac("sha256", META).update(corpo).digest("hex")}`;
    expect(verifyMetaSignature(META, corpo, certa)).toBe(true);
    expect(verifyMetaSignature(META, corpo, certa.replace(/.$/, "0"))).toBe(false);
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
    await inboundWebhook(pedido(corpoDaMeta({}), { timestamp: new Date(Date.now() - 600_000).toISOString() }), res);
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
    expect([...store.keys()].some((k) => k.startsWith(`organizations/${ORG}/messages/`))).toBe(true);
  });
});

describe("de quem e a mensagem", () => {
  it("numero que nao e de remetente cadastrado nao vira mensagem de ninguem", async () => {
    consultas.senders = [];
    expect(await applyInboundEvent(evento())).toEqual({ outcome: "UNKNOWN_SENDER" });
    expect(store.size).toBe(1);
  });

  it("dois cadastros com o mesmo numero: ninguem recebe, em vez de a clinica errada receber", async () => {
    consultas.senders = [sender(), sender({ organizationId: "outra-clinica" })];
    expect(await applyInboundEvent(evento())).toEqual({ outcome: "UNKNOWN_SENDER" });
  });

  it("remetente ainda nao aprovado nao recebe", async () => {
    consultas.senders = [sender({ status: "PENDING" })];
    expect(await applyInboundEvent(evento())).toEqual({ outcome: "UNKNOWN_SENDER" });
  });

  it("numero desconhecido vira conversa SEM vinculo, e nao e procurado em outra organizacao", async () => {
    const resultado = await applyInboundEvent(evento());

    expect(resultado.organizationId).toBe(ORG);
    expect(resultado.clientId).toBeNull();
    const conversa = store.get(paths.document(ORG, "conversations", resultado.conversationId));
    expect(conversa.clientId).toBeNull();
    expect(conversa.clientName).toBe("Contato não identificado");
    // Nenhuma leitura de cliente saiu da organizacao do remetente.
    expect([...store.keys()].every((k) => !k.startsWith("organizations/outra-clinica"))).toBe(true);
  });
});

describe("o que chega", () => {
  beforeEach(() => {
    consultas.clients = [{ id: "cliente-1", organizationId: ORG, fullName: "Alex Fictício", phone: `+${FROM}`, notificationConsent: null }];
  });

  it("reentrega da Meta nao duplica mensagem nem decisao", async () => {
    await applyInboundEvent(evento());
    const antes = store.size;

    expect(await applyInboundEvent(evento())).toMatchObject({ outcome: "DUPLICATE" });
    expect(store.size).toBe(antes);
  });

  it("mensagem atrasada e gravada, mas nao vira o resumo da conversa", async () => {
    await applyInboundEvent(evento({ providerMessageId: "wamid.nova", text: "Mensagem mais nova", sentAt: "2026-09-20T13:00:00.000Z" }));
    const resultado = await applyInboundEvent(
      evento({ providerMessageId: "wamid.velha", text: "Mensagem atrasada", sentAt: "2026-09-20T12:00:00.000Z" }),
    );

    expect(resultado.outcome).toBe("OUT_OF_ORDER");
    expect(store.get(paths.document(ORG, "messages", "wa-wamidvelha"))).toBeTruthy();
    expect(store.get(paths.document(ORG, "conversations", "wa-cliente-1")).lastMessagePreview).toBe("Mensagem mais nova");
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
            WHATSAPP: [{ granted: { at: "2026-09-01T12:00:00.000Z", recordedBy: { kind: "STAFF", userId: "membro", name: "Equipe" }, medium: "FORM" }, textVersion: "v1", subjectIsMinor: false, legalGuardian: null, withdrawn: null }],
            EMAIL: [{ granted: { at: "2026-09-01T12:00:00.000Z", recordedBy: { kind: "STAFF", userId: "membro", name: "Equipe" }, medium: "FORM" }, textVersion: "v1", subjectIsMinor: false, legalGuardian: null, withdrawn: null }],
          },
          legacy: null,
        },
      },
    ];

    const resultado = await applyInboundEvent(evento({ providerMessageId: "wamid.sair", text: "SAIR" }));

    expect(resultado.outcome).toBe("OPT_OUT");
    const cliente = store.get(paths.document(ORG, "clients", "cliente-1"));
    expect(cliente.notificationConsent.channels.WHATSAPP.at(-1).withdrawn).toMatchObject({
      recordedBy: { kind: "SUBJECT" },
      medium: "MESSAGE",
    });
    // Quem pediu para parar no WhatsApp nao pediu para parar no e-mail.
    expect(cliente.notificationConsent.channels.EMAIL.at(-1).withdrawn).toBeNull();
    expect(store.get(paths.document(ORG, "auditLogs", "wa-wamidsair-consent"))).toBeTruthy();
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
    const registro = store.get(paths.document(ORG, "auditLogs", "wa-wamidbotao-confirm"));
    expect(registro.summary).toContain("própria pessoa");
    expect(registro.metadata).toMatchObject({ channel: "WHATSAPP", button: "CONFIRM" });
  });

  it("mensagem de risco vira alerta CRITICAL e NUNCA resposta automatica", async () => {
    const resultado = await applyInboundEvent(
      evento({ providerMessageId: "wamid.risco", text: "não consigo mais, penso em me matar" }),
    );

    expect(resultado.outcome).toBe("CLASSIFIED");
    expect(resultado.classification).toBe("POSSIBLE_RISK");
    expect(resultado.attention).toBe("CRITICAL");
    expect(resultado.action).not.toBe("AUTO_RESPONSE");

    const alerta = store.get(paths.document(ORG, "notifications", "wa-wamidrisco-alerta"));
    expect(alerta).toMatchObject({ severity: "CRITICAL", status: "UNREAD" });
    const decisao = store.get(paths.document(ORG, "aiDecisions", "wa-wamidrisco-decision"));
    expect(decisao).toMatchObject({ classification: "POSSIBLE_RISK", responseText: null });
  });

  it("mensagem comum gera decisao registrada, sem alerta critico", async () => {
    const resultado = await applyInboundEvent(evento({ providerMessageId: "wamid.comum" }));

    expect(resultado.outcome).toBe("CLASSIFIED");
    expect(store.get(paths.document(ORG, "aiDecisions", "wa-wamidcomum-decision"))).toBeTruthy();
    expect(store.get(paths.document(ORG, "notifications", "wa-wamidcomum-alerta"))).toBeUndefined();
  });

  it("a janela de 24 horas que a pessoa abriu fica gravada na conversa", async () => {
    const resultado = await applyInboundEvent(evento({ providerMessageId: "wamid.janela" }));
    expect(store.get(paths.document(ORG, "conversations", resultado.conversationId)).inboundWindowEndsAt).toBe(
      "2026-09-21T12:00:00.000Z",
    );
  });
});
