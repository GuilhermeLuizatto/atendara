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
const consultas = vi.hoisted(() => ({ senders: [], clients: [], rules: [], appointments: [] }));
const gemini = vi.hoisted(() => ({ generate: vi.fn(), reserve: vi.fn() }));
vi.mock("./rate-limit.js", () => ({ consumeRateLimit: gemini.reserve }));

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
  const consulta = (lista) => ({
    where: () => consulta(lista),
    orderBy: () => consulta(lista),
    limit: () => consulta(lista),
    get: async () => docsDe(lista),
  });
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
      collection: (path) =>
        path.endsWith("/aiRules")
          ? consulta(consultas.rules)
          : path.endsWith("/appointments")
            ? consulta(consultas.appointments)
            : consulta(consultas.clients),
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
  consultas.appointments = [];
  process.env.N8N_CALLBACK_SECRET = PONTE;
  process.env.META_APP_SECRET = META;
  store.set(paths.organization(ORG), { id: ORG, primaryProfession: "PSYCHOLOGIST", ownerId: "dono" });
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

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
    gemini.generate.mockResolvedValue({ ok: true, text: async () => JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({
        classification: "POSSIBLE_RISK", confidence: 0.96, intent: "NONE", ambiguous: false,
      }) }] } }], usageMetadata: { promptTokenCount: 250, candidatesTokenCount: 40 },
    }) });
    const event = evento({ text: "Já deixei as cartas de despedida e hoje vou acabar com tudo." });
    await applyInboundEvent(event);
    const decisions = [...store.entries()].filter(([key]) => key.includes("/aiDecisions/"));
    expect(decisions).toHaveLength(1);
    expect(decisions[0][1]).toMatchObject({ classification: "POSSIBLE_RISK", attention: "CRITICAL",
      action: "ESCALATE_TO_PROFESSIONAL", inputPreview: "", classifier: { status: "SUCCEEDED", model: "gemini-3.1-flash-lite" } });
    await applyInboundEvent(event);
    expect(gemini.generate).toHaveBeenCalledTimes(1);
  });
  it("falha do Gemini encaminha ao humano, sem resposta automática local", async () => {
    enableGemini();
    gemini.generate.mockRejectedValue(new Error("rede indisponível"));
    await applyInboundEvent(evento({ text: "Qual o valor da consulta?" }));
    const decision = [...store.entries()].find(([key]) => key.includes("/aiDecisions/"))[1];
    expect(decision).toMatchObject({ classification: "UNKNOWN", action: "ESCALATE_TO_PROFESSIONAL", classifier: { status: "UNAVAILABLE" } });
  });
  it("risco lexical não sai para o provedor", async () => {
    enableGemini();
    await applyInboundEvent(evento({ text: "Quero morrer." }));
    expect(gemini.generate).not.toHaveBeenCalled();
    const decision = [...store.entries()].find(([key]) => key.includes("/aiDecisions/"))[1];
    expect(decision.classifier.status).toBe("LOCAL_GUARD");
    expect(decision.attention).toBe("CRITICAL");
  });
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
    consultas.clients = [{ id: "cliente-1", organizationId: ORG, fullName: "Alex Fictício", phone: `+${FROM}`, notificationConsent: null }];
    consultas.appointments = [atendimento()];
    store.set(paths.organization(ORG), organizacao({ enabled: true, minimumNoticeHours: 24, maxReschedulesPerAppointment: 1, offeredSlots: 3, allowProfessionalChange: false, searchWindowDays: 14 }));
  });

  it("politica desligada: o pedido vira alerta para a equipe, com o motivo escrito", async () => {
    store.set(paths.organization(ORG), organizacao(null));

    const resultado = await applyInboundEvent(PEDIDO, { clock: () => "2026-09-21T11:00:00.000Z" });

    expect(resultado.outcome).toBe("RESCHEDULE_ESCALATED");
    expect(resultado.reason).toBe("POLICY_DISABLED");
    const alerta = store.get(paths.document(ORG, "notifications", "wa-wamidremarcar-remarcacao"));
    expect(alerta).toMatchObject({ severity: "HIGH", status: "UNREAD" });
    expect(alerta.body).toContain("não permite remarcação");
    expect(store.get(paths.document(ORG, "rescheduleRequests", CONVERSA))).toBeUndefined();
  });

  it("pedido em cima da hora escala, mesmo com a politica ligada", async () => {
    consultas.appointments = [atendimento({ startsAt: "2026-09-21T13:00:00.000Z", endsAt: "2026-09-21T13:50:00.000Z" })];

    const resultado = await applyInboundEvent(PEDIDO, { clock: () => "2026-09-21T11:00:00.000Z" });

    expect(resultado).toMatchObject({ outcome: "RESCHEDULE_ESCALATED", reason: "TOO_LATE" });
  });

  it("dentro da politica, oferece horarios e segura a escolha por poucos minutos", async () => {
    const resultado = await applyInboundEvent(PEDIDO, { clock: () => "2026-09-21T11:00:00.000Z" });

    expect(resultado.outcome).toBe("RESCHEDULE_OFFERED");
    const pedido = store.get(paths.document(ORG, "rescheduleRequests", CONVERSA));
    expect(pedido.status).toBe("OFFERED");
    expect(pedido.slots).toHaveLength(3);
    expect(pedido.appointmentId).toBe("atendimento-1");
    // Gravado como Timestamp, como tudo o que e data no banco.
    expect(pedido.holdEndsAt.toDate().getTime()).toBeGreaterThan(Date.parse("2026-09-21T11:00:00.000Z"));
  });

  it("escolher um dos horarios grava o atendimento novo, com trilha", async () => {
    await applyInboundEvent(PEDIDO, { clock: () => "2026-09-21T11:00:00.000Z" });
    store.set(paths.document(ORG, "appointments", "atendimento-1"), atendimento());
    const oferecidos = store.get(paths.document(ORG, "rescheduleRequests", CONVERSA)).slots;
    const comoIso = (valor) => (typeof valor === "string" ? valor : valor.toDate().toISOString());

    const resultado = await applyInboundEvent(
      { ...PEDIDO, kind: "TEXT", providerMessageId: "wamid.escolha", text: "1", button: undefined },
      { clock: () => "2026-09-21T11:02:00.000Z" },
    );

    expect(resultado.outcome).toBe("RESCHEDULE_CONFIRMED");
    const gravado = store.get(paths.document(ORG, "appointments", "atendimento-1"));
    expect(comoIso(gravado.startsAt)).toBe(comoIso(oferecidos[0].startsAt));
    expect(gravado.status).toBe("SCHEDULED");
    expect(gravado.origin).toBe("CLIENT_SELF_SERVICE");
    expect(store.get(paths.document(ORG, "rescheduleRequests", CONVERSA)).status).toBe("CONFIRMED");
    expect(store.get(paths.document(ORG, "auditLogs", "wa-wamidescolha-remarcado")).summary).toContain("própria pessoa");
  });

  it("reserva vencida nao confirma: o horario voltou a ser de quem quiser", async () => {
    await applyInboundEvent(PEDIDO, { clock: () => "2026-09-21T11:00:00.000Z" });
    store.set(paths.document(ORG, "appointments", "atendimento-1"), atendimento());

    const resultado = await applyInboundEvent(
      { ...PEDIDO, kind: "TEXT", providerMessageId: "wamid.tarde", text: "1", button: undefined },
      { clock: () => "2026-09-21T11:30:00.000Z" },
    );

    // Passada a reserva, a escolha nao vale mais e o texto volta a ser texto.
    expect(resultado.outcome).not.toBe("RESCHEDULE_CONFIRMED");
  });
});

describe("agenda externa na oferta (13.7)", () => {
  it("compromisso pessoal no Google impede oferecer aquele horario", async () => {
    consultas.clients = [{ id: "cliente-1", organizationId: ORG, fullName: "Alex Fictício", phone: `+${FROM}`, notificationConsent: null }];
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
          reschedule: { enabled: true, minimumNoticeHours: 24, maxReschedulesPerAppointment: 1, offeredSlots: 3, allowProfessionalChange: false, searchWindowDays: 14 },
        },
      },
    });

    const agora = "2026-09-21T11:00:00.000Z";
    // A manha inteira de 22/09 ocupada na agenda pessoal.
    store.set(paths.document(ORG, "calendarBusyBlocks", "profissional-1"), {
      id: "profissional-1",
      organizationId: ORG,
      professionalId: "profissional-1",
      blocks: [{ startsAt: "2026-09-22T11:00:00.000Z", endsAt: "2026-09-22T15:00:00.000Z" }],
      readAt: agora,
    });

    const resultado = await applyInboundEvent(
      { kind: "BUTTON", providerSenderId: SENDER_ID, from: FROM, providerMessageId: "wamid.externa", button: "RESCHEDULE", repliedTo: null, sentAt: agora },
      { clock: () => agora },
    );

    expect(resultado.outcome).toBe("RESCHEDULE_OFFERED");
    const oferecidos = store.get(paths.document(ORG, "rescheduleRequests", "wa-cliente-1")).slots;
    const comoIso = (valor) => (typeof valor === "string" ? valor : valor.toDate().toISOString());
    // Nenhum horario oferecido cai dentro do compromisso pessoal.
    for (const slot of oferecidos) {
      expect(comoIso(slot.startsAt) >= "2026-09-22T15:00:00.000Z" || comoIso(slot.startsAt) < "2026-09-22T11:00:00.000Z").toBe(true);
    }
  });
});
