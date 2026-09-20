import { createHmac, timingSafeEqual } from "node:crypto";

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";

import { fromStored, toStored } from "./firestore-dates.js";
import {
  BRIDGE_SIGNATURE_HEADER,
  BRIDGE_TIMESTAMP_HEADER,
  isWithinSignatureWindow,
} from "./generated/automation-bridge.js";
import {
  decideInbound,
  inboundMessageId,
  inboundWindowEndsAt,
  normalizeInboundPhone,
  parseInboundPayload,
} from "./generated/automation-inbound.js";
import { INBOUND_CONFIRMATION_NOTE, INBOUND_OPT_OUT_NOTE, INBOUND_PREVIEW_LENGTH } from "./generated/inbound-config.js";
import { decide } from "./generated/decision-engine.js";
import { confirmReschedule, decideReschedule, policyOf } from "./generated/agenda-reschedule.js";
import { RESCHEDULE_REFUSAL_LABELS } from "./generated/reschedule-config.js";
import { isBusySnapshotFresh } from "./generated/agenda-calendar.js";
import { applyConsentChanges, plannedConsentChanges } from "./generated/notifications-consent-record.js";
import { withOrganizationDefaults } from "./generated/organization-config.js";
import { getProfession, isProfessionId } from "./generated/professions.js";
import { ROLE_PERMISSIONS } from "./generated/permissions.js";
import { paths } from "./generated/paths.js";
import { verifyBridgeSignature } from "./n8n-bridge.js";
import { runAs } from "./service-accounts.js";

/**
 * A mensagem que chega (Fase 3, 13.5).
 *
 * **Duas assinaturas, e as duas conferidas aqui.** O n8n prova que o pedido
 * veio dele (segredo B); a Meta prova que o corpo e dela
 * (`X-Hub-Signature-256` com o App Secret). Conferir so a do n8n deixaria um
 * n8n comprometido inventar mensagem de paciente; conferir so a da Meta
 * deixaria qualquer um que conheca a URL repassar corpo capturado.
 *
 * **Quem e quem nao sai do corpo.** A organizacao sai do `phone_number_id`
 * cadastrado em `messagingSenders`; a pessoa sai do telefone normalizado
 * **dentro daquela organizacao**. Numero desconhecido vira conversa sem
 * vinculo — e **nunca** e procurado em outra organizacao: fazer isso contaria a
 * uma clinica que aquela pessoa e atendida na outra.
 */

const REGION = "southamerica-east1";
const SECRETS = ["N8N_CALLBACK_SECRET", "META_APP_SECRET"];

const db = () => getFirestore();

function stored(collection, snapshot) {
  return snapshot?.exists ? fromStored(collection, snapshot.id, snapshot.data()) : null;
}

/** Assinatura da Meta: `sha256=` mais o HMAC do corpo BRUTO com o App Secret. */
export function verifyMetaSignature(appSecret, rawBody, header) {
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  if (expected.length !== header.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(header, "utf8"));
  } catch {
    return false;
  }
}

/**
 * De qual organizacao e o numero que recebeu. A consulta e por grupo de
 * colecao, e o que ela devolve e a UNICA organizacao dona daquele
 * `phone_number_id`: dois cadastros com o mesmo numero seriam erro de cadastro,
 * e nesse caso ninguem recebe — melhor do que entregar a conversa a clinica
 * errada.
 */
export async function organizationOfSender(providerSenderId) {
  const found = await db()
    .collectionGroup("messagingSenders")
    .where("providerSenderId", "==", providerSenderId)
    .limit(2)
    .get();

  if (found.size !== 1) return null;
  const sender = fromStored("messagingSenders", found.docs[0].id, found.docs[0].data());
  return sender.status === "APPROVED" ? sender : null;
}

/** A pessoa, procurada SO dentro daquela organizacao. */
async function clientOfPhone(organizationId, phone) {
  const found = await db()
    .collection(paths.collection(organizationId, "clients"))
    .where("phone", "==", phone)
    .limit(2)
    .get();
  return found.size === 1 ? stored("clients", found.docs[0]) : null;
}

function preview(text) {
  return text.length > INBOUND_PREVIEW_LENGTH ? `${text.slice(0, INBOUND_PREVIEW_LENGTH - 1)}…` : text;
}

/**
 * Grava o que chegou. Mensagem, conversa e consequencia na MESMA transacao: a
 * mensagem nunca existe sem a conversa, e a retirada de consentimento nunca
 * existe sem a mensagem que a pediu.
 */
export async function applyInboundEvent(event, deps = {}) {
  const { clock = () => new Date().toISOString() } = deps;
  const now = clock();

  const sender = await organizationOfSender(event.providerSenderId);
  if (!sender) return { outcome: "UNKNOWN_SENDER" };

  const organizationId = sender.organizationId;
  const phone = normalizeInboundPhone(event.from);
  const client = phone ? await clientOfPhone(organizationId, phone) : null;

  const firestore = db();
  const scope = {
    doc: (collection, id) => firestore.doc(paths.document(organizationId, collection, id)),
  };
  // Conversa por pessoa quando ha vinculo; por numero quando nao ha. Numero
  // desconhecido conversa com a clinica sem virar cadastro sozinho.
  const conversationId = client ? `wa-${client.id}` : `wa-anonimo-${phone ?? "sem-numero"}`;
  const messageId = inboundMessageId(event.providerMessageId);

  return firestore.runTransaction(async (transaction) => {
    const conversation = stored("conversations", await transaction.get(scope.doc("conversations", conversationId)));
    const existing = await transaction.get(scope.doc("messages", messageId));
    // Leituras antes de qualquer escrita: e exigencia da transacao, e tambem o
    // que garante que a decisao use o estado do mesmo instante.
    const organizationSnapshot = await transaction.get(firestore.doc(paths.organization(organizationId)));
    const rules = (await transaction.get(firestore.collection(paths.collection(organizationId, "aiRules")))).docs.map(
      (document) => stored("aiRules", document),
    );
    const pendingRaw = stored("rescheduleRequests", await transaction.get(scope.doc("rescheduleRequests", conversationId)));
    // Reserva vencida nao vale escolha: o horario ja voltou a ser de quem quiser.
    const pending =
      pendingRaw && pendingRaw.status === "OFFERED" && Date.parse(now) <= Date.parse(pendingRaw.holdEndsAt)
        ? pendingRaw
        : null;

    const decision = decideInbound({
      event,
      knownProviderMessageIds: existing.exists ? [event.providerMessageId] : [],
      lastInboundAt: conversation?.lastMessageAt ?? null,
    });
    if (decision.kind === "DUPLICATE") return { outcome: "DUPLICATE", organizationId };

    const body = event.kind === "TEXT" ? event.text : event.button === "CONFIRM" ? "Confirmar" : "Remarcar";

    transaction.create(
      scope.doc("messages", messageId),
      toStored("messages", {
        id: messageId,
        organizationId,
        conversationId,
        clientId: client?.id ?? null,
        direction: "INBOUND",
        authorType: "CLIENT",
        authorName: client?.fullName ?? "Contato não identificado",
        channel: "WHATSAPP",
        body,
        sentAt: event.sentAt,
        providerMessageId: event.providerMessageId,
        createdAt: now,
        createdBy: null,
        updatedAt: now,
        updatedBy: null,
      }),
    );

    // Mensagem atrasada e gravada — a conversa e prova —, mas nao muda o resumo
    // nem a atencao: a ordem de chegada nao reescreve o que ja se sabe.
    if (decision.kind !== "OUT_OF_ORDER") {
      transaction.set(
        scope.doc("conversations", conversationId),
        toStored("conversations", {
          id: conversationId,
          organizationId,
          clientId: client?.id ?? null,
          clientName: client?.fullName ?? "Contato não identificado",
          professionalId: conversation?.professionalId ?? null,
          channel: "WHATSAPP",
          status: "OPEN",
          attention: conversation?.attention ?? "NORMAL",
          lastClassification: conversation?.lastClassification ?? null,
          lastMessagePreview: preview(body),
          lastMessageAt: event.sentAt,
          unreadCount: (conversation?.unreadCount ?? 0) + 1,
          escalated: conversation?.escalated ?? false,
          escalationReason: conversation?.escalationReason ?? null,
          // A janela de texto livre que a propria pessoa abriu.
          inboundWindowEndsAt: inboundWindowEndsAt(event.sentAt),
          createdAt: conversation?.createdAt ?? now,
          createdBy: null,
          updatedAt: now,
          updatedBy: null,
        }),
      );
    }

    if (decision.kind === "OPT_OUT" && client) {
      const changes = plannedConsentChanges(
        client.notificationConsent,
        // Retira so o WhatsApp: quem pediu para parar no WhatsApp nao pediu
        // para parar no e-mail.
        (client.notificationConsent ? activeChannelsExceptWhatsapp(client) : []),
      );
      const consent = applyConsentChanges(client.notificationConsent, changes, {
        at: now,
        // A propria pessoa, pelo canal: nao e a equipe anotando.
        recordedBy: { kind: "SUBJECT", userId: null, name: client.fullName },
        medium: "MESSAGE",
      }, { textVersion: null, subjectIsMinor: false, legalGuardian: null });

      transaction.set(
        scope.doc("clients", client.id),
        toStored("clients", { ...client, notificationConsent: consent, updatedAt: now, updatedBy: null }),
      );
      transaction.create(
        scope.doc("auditLogs", `${messageId}-consent`),
        toStored("auditLogs", {
          id: `${messageId}-consent`,
          organizationId,
          actorType: "SYSTEM",
          actorId: null,
          actorName: "Automação do Atendara",
          action: "CLIENT_UPDATED",
          resource: { type: "client", id: client.id },
          summary: INBOUND_OPT_OUT_NOTE,
          metadata: { channel: "WHATSAPP", messageId },
          createdAt: now,
          createdBy: null,
          updatedAt: now,
          updatedBy: null,
        }),
      );
      return { outcome: "OPT_OUT", organizationId, conversationId };
    }

    if (decision.kind === "CONFIRM" && client) {
      transaction.create(
        scope.doc("auditLogs", `${messageId}-confirm`),
        toStored("auditLogs", {
          id: `${messageId}-confirm`,
          organizationId,
          actorType: "SYSTEM",
          actorId: null,
          actorName: "Automação do Atendara",
          action: "APPOINTMENT_UPDATED",
          resource: { type: "client", id: client.id },
          summary: INBOUND_CONFIRMATION_NOTE,
          metadata: { channel: "WHATSAPP", messageId, button: "CONFIRM" },
          createdAt: now,
          createdBy: null,
          updatedAt: now,
          updatedBy: null,
        }),
      );
    }

    // Remarcacao pedida pelo botao (13.6). O que decide e a politica da
    // organizacao, nao o pedido: fora dela, o pedido nao some — muda de dono.
    if (decision.kind === "RESCHEDULE") {
      const resultado = await handleRescheduleRequest({
        transaction,
        scope,
        firestore,
        organizationId,
        organizationSnapshot,
        conversationId,
        client,
        messageId,
        now,
      });
      return { outcome: resultado.outcome, organizationId, conversationId, clientId: client?.id ?? null, reason: resultado.reason ?? null };
    }

    // Escolha de um dos horarios oferecidos: "1", "2", "3". A conferencia de
    // que o horario CONTINUA livre acontece aqui dentro, na mesma transacao —
    // entre oferecer e escolher passa gente marcando.
    if (decision.kind === "CLASSIFY" && pending && event.kind === "TEXT") {
      const escolha = Number(event.text.trim());
      if (Number.isInteger(escolha) && escolha >= 1 && escolha <= pending.slots.length) {
        const resultado = await confirmChosenSlot({
          transaction,
          scope,
          pending,
          chosen: pending.slots[escolha - 1],
          appointment: stored("appointments", await transaction.get(scope.doc("appointments", pending.appointmentId))),
          busy: pending.busy ?? [],
          messageId,
          now,
        });
        return { outcome: resultado.outcome, organizationId, conversationId, clientId: client?.id ?? null, reason: resultado.reason ?? null };
      }
    }

    // Texto comum vai ao motor: classificacao, regras, contexto e permissao.
    // Aqui NAO se responde — so se registra o que seria feito. Resposta que
    // sai e tarefa da fila, com as travas da regra 11; mandar daqui pularia
    // consentimento, canal permitido pela profissao e remetente comprovado.
    if (decision.kind === "CLASSIFY") {
      const rawOrganization = stored("organizations", organizationSnapshot);
      const profession = rawOrganization && isProfessionId(rawOrganization.primaryProfession)
        ? getProfession(rawOrganization.primaryProfession)
        : null;

      if (profession) {
        const organization = withOrganizationDefaults(rawOrganization, organizationId, rawOrganization.primaryProfession, now);
        const decided = decide({
          text: event.text,
          profession,
          organization,
          rules,
          channel: "WHATSAPP",
          client: client ? { modality: client.modality ?? null, status: client.status ?? null, hasOutstandingBalance: false } : null,
          now: new Date(now),
          professionalId: conversation?.professionalId ?? null,
          // A automacao age com as permissoes da propria organizacao, nunca com
          // as de uma pessoa: decisao de robo nao herda papel de ninguem.
          permissions: ROLE_PERMISSIONS.OWNER,
        });

        const decisionId = `${messageId}-decision`;
        transaction.create(
          scope.doc("aiDecisions", decisionId),
          toStored("aiDecisions", {
            id: decisionId,
            organizationId,
            conversationId,
            messageId,
            clientId: client?.id ?? null,
            professionalId: conversation?.professionalId ?? null,
            inputPreview: preview(event.text),
            classification: decided.trace.classification.classification,
            confidence: decided.trace.classification.confidence,
            appliedRules: decided.appliedRules ?? [],
            action: decided.action,
            responseText: decided.responseText ?? null,
            reason: decided.reason,
            attention: decided.attention,
            escalated: decided.escalated ?? decided.action === "ESCALATE_TO_PROFESSIONAL",
            engineVersion: decided.engineVersion ?? "13.5",
            decidedAt: now,
            latencyMs: 0,
            createdAt: now,
            createdBy: null,
            updatedAt: now,
            updatedBy: null,
          }),
        );

        transaction.set(
          scope.doc("conversations", conversationId),
          toStored("conversations", {
            id: conversationId,
            organizationId,
            clientId: client?.id ?? null,
            clientName: client?.fullName ?? "Contato não identificado",
            professionalId: conversation?.professionalId ?? null,
            channel: "WHATSAPP",
            status: "OPEN",
            attention: decided.attention,
            lastClassification: decided.trace.classification.classification,
            lastMessagePreview: preview(body),
            lastMessageAt: event.sentAt,
            unreadCount: (conversation?.unreadCount ?? 0) + 1,
            escalated: decided.escalated ?? decided.action === "ESCALATE_TO_PROFESSIONAL",
            escalationReason: decided.reason,
            inboundWindowEndsAt: inboundWindowEndsAt(event.sentAt),
            createdAt: conversation?.createdAt ?? now,
            createdBy: null,
            updatedAt: now,
            updatedBy: null,
          }),
        );

        // Risco vira alerta CRITICAL para gente, e nunca resposta automatica: a
        // trava vive em CLASSIFICATION_META e e o motor que a aplica.
        if (decided.attention === "CRITICAL") {
          const alertId = `${messageId}-alerta`;
          transaction.create(
            scope.doc("notifications", alertId),
            toStored("notifications", {
              id: alertId,
              organizationId,
              kind: "AI_ESCALATION",
              status: "UNREAD",
              severity: "CRITICAL",
              title: "Mensagem que precisa de atenção humana",
              body: "Uma mensagem recebida foi classificada como possível risco. Nenhuma resposta automática foi enviada.",
              resource: { type: "conversation", id: conversationId },
              createdAt: now,
              createdBy: null,
              updatedAt: now,
              updatedBy: null,
            }),
          );
        }

        return {
          outcome: "CLASSIFIED",
          organizationId,
          conversationId,
          clientId: client?.id ?? null,
          classification: decided.trace.classification.classification,
          action: decided.action,
          attention: decided.attention,
        };
      }
    }

    return { outcome: decision.kind, organizationId, conversationId, clientId: client?.id ?? null };
  });
}

function activeChannelsExceptWhatsapp(client) {
  const consent = client.notificationConsent;
  if (!consent || typeof consent !== "object" || !("channels" in consent)) return [];
  return Object.entries(consent.channels ?? {})
    .filter(([channel, history]) => channel !== "WHATSAPP" && history?.at(-1)?.withdrawn == null)
    .map(([channel]) => channel);
}

export const inboundWebhook = onRequest(
  { region: REGION, maxInstances: 5, secrets: SECRETS, ...runAs("automacao") },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Método não suportado.");
      return;
    }

    const bridgeSecret = process.env.N8N_CALLBACK_SECRET;
    const appSecret = process.env.META_APP_SECRET;
    if (!bridgeSecret || !appSecret) {
      logger.error("automation.inbound.no_secret");
      response.status(503).send("Entrada de mensagens não configurada.");
      return;
    }

    const raw = request.rawBody ?? Buffer.alloc(0);
    const body = raw.toString("utf8");
    const timestamp = request.get(BRIDGE_TIMESTAMP_HEADER);
    const now = new Date().toISOString();

    // 1. O n8n, com janela: repasse capturado nao vale para sempre.
    if (!timestamp || !isWithinSignatureWindow(timestamp, now)) {
      logger.warn("automation.inbound.refused", { outcome: "STALE_TIMESTAMP" });
      response.status(401).send("Assinatura inválida.");
      return;
    }
    if (!verifyBridgeSignature(bridgeSecret, timestamp, body, request.get(BRIDGE_SIGNATURE_HEADER))) {
      logger.warn("automation.inbound.refused", { outcome: "BAD_BRIDGE_SIGNATURE" });
      response.status(401).send("Assinatura inválida.");
      return;
    }
    // 2. A Meta, sobre o corpo bruto. Sem ela, um n8n comprometido inventaria
    //    mensagem de paciente.
    if (!verifyMetaSignature(appSecret, raw, request.get("x-hub-signature-256"))) {
      logger.warn("automation.inbound.refused", { outcome: "BAD_META_SIGNATURE" });
      response.status(401).send("Assinatura inválida.");
      return;
    }

    let events = [];
    try {
      events = parseInboundPayload(JSON.parse(body));
    } catch {
      events = [];
    }

    try {
      const outcomes = [];
      for (const event of events) outcomes.push((await applyInboundEvent(event)).outcome);
      logger.info("automation.inbound", { received: events.length, outcomes });
      // 200 sempre que o corpo foi aceito: a Meta reentrega o que nao recebe
      // 200, e reentrega e inofensiva pela trava de duplicidade.
      response.status(200).json({ received: events.length });
    } catch (error) {
      logger.error("automation.inbound.failed", { message: String(error) });
      response.status(500).send("Falha ao processar a mensagem.");
    }
  },
);

/**
 * O pedido de remarcacao: le a politica, procura o atendimento futuro e os
 * horarios livres, e ou oferece (segurando a escolha) ou escala com o motivo.
 *
 * **Escalar nao e falhar.** Fora da politica, o pedido vira alerta para a
 * equipe — com o motivo escrito —, e a pessoa nao fica sem resposta.
 */
async function handleRescheduleRequest(ctx) {
  const { transaction, scope, firestore, organizationId, organizationSnapshot, conversationId, client, messageId, now } = ctx;

  const organization = stored("organizations", organizationSnapshot);
  const agenda = organization?.settings?.agenda ?? null;
  const policy = policyOf(agenda?.reschedule ?? null);

  // Atendimentos futuros da pessoa, que sao ao mesmo tempo o candidato a
  // remarcacao e parte do que ocupa a agenda.
  const futuros = client
    ? (
        await transaction.get(
          firestore
            .collection(paths.collection(organizationId, "appointments"))
            .where("clientId", "==", client.id)
            .where("startsAt", ">=", Timestamp.fromDate(new Date(now)))
            .orderBy("startsAt")
            .limit(5),
        )
      ).docs.map((document) => stored("appointments", document))
    : [];
  const appointment = futuros.find((item) => item.status === "SCHEDULED" || item.status === "CONFIRMED") ?? futuros[0] ?? null;

  const agendaExterna = appointment
    ? stored("calendarBusyBlocks", await transaction.get(scope.doc("calendarBusyBlocks", appointment.professionalId)))
    : null;

  const busy = (
    await transaction.get(
      firestore
        .collection(paths.collection(organizationId, "appointments"))
        .where("startsAt", ">=", Timestamp.fromDate(new Date(now)))
        .orderBy("startsAt")
        .limit(200),
    )
  ).docs
    .map((document) => stored("appointments", document))
    .filter((item) => item.status !== "CANCELLED" && item.status !== "NO_SHOW")
    .map((item) => ({ startsAt: item.startsAt, endsAt: item.endsAt }));

  // Ocupado da agenda pessoal (13.7). Entra na MESMA lista: um compromisso no
  // Google impede oferecer aquele horario. Leitura velha NAO entra — oferecer
  // com dado velho e como oferecer horario que ja foi tomado.
  if (agendaExterna && isBusySnapshotFresh(agendaExterna.readAt, now)) {
    busy.push(...(agendaExterna.blocks ?? []));
  }

  const decided = decideReschedule({
    policy,
    appointment,
    previousReschedules: appointment?.rescheduledFromId ? 1 : 0,
    availability: {
      agenda: agenda ?? { workingDays: [1, 2, 3, 4, 5], workdayStart: "08:00", workdayEnd: "18:00", slotIntervalMinutes: 30 },
      bufferMinutes: 0,
      from: now,
      to: new Date(Date.parse(now) + policy.searchWindowDays * 86_400_000).toISOString(),
      busy,
      // Fuso da organizacao: o expediente e lido nele, e a resposta sai em UTC.
      timezoneOffsetMinutes: offsetOfTimezone(organization?.timezone),
    },
    now,
  });

  if (decided.kind === "ESCALATE") {
    const alertId = `${messageId}-remarcacao`;
    transaction.create(
      scope.doc("notifications", alertId),
      toStored("notifications", {
        id: alertId,
        organizationId,
        kind: "AI_ESCALATION",
        status: "UNREAD",
        severity: "HIGH",
        title: "Pedido de remarcação para a equipe",
        body: RESCHEDULE_REFUSAL_LABELS[decided.reason],
        resource: { type: "conversation", id: conversationId },
        createdAt: now,
        createdBy: null,
        updatedAt: now,
        updatedBy: null,
      }),
    );
    return { outcome: "RESCHEDULE_ESCALATED", reason: decided.reason };
  }

  transaction.set(
    scope.doc("rescheduleRequests", conversationId),
    toStored("rescheduleRequests", {
      id: conversationId,
      organizationId,
      clientId: client?.id ?? null,
      appointmentId: decided.appointment.id,
      status: "OFFERED",
      slots: decided.slots,
      busy,
      holdEndsAt: decided.holdEndsAt,
      offeredAt: now,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    }),
  );
  return { outcome: "RESCHEDULE_OFFERED" };
}

/** A escolha da pessoa, conferida contra a agenda do mesmo instante. */
async function confirmChosenSlot(ctx) {
  const { transaction, scope, pending, chosen, appointment, busy, messageId, now } = ctx;
  if (!appointment) return { outcome: "RESCHEDULE_ESCALATED", reason: "APPOINTMENT_NOT_FOUND" };

  const confirmacao = confirmReschedule({
    appointment,
    chosen,
    busy,
    bufferMinutes: 0,
    holdEndsAt: pending.holdEndsAt,
    now,
  });

  if (confirmacao.kind === "RETRY") {
    transaction.set(
      scope.doc("rescheduleRequests", pending.id),
      toStored("rescheduleRequests", { ...pending, status: "EXPIRED", updatedAt: now, updatedBy: null }),
    );
    return { outcome: "RESCHEDULE_RETRY", reason: confirmacao.reason };
  }

  transaction.set(scope.doc("appointments", appointment.id), toStored("appointments", confirmacao.appointment));
  transaction.set(
    scope.doc("rescheduleRequests", pending.id),
    toStored("rescheduleRequests", { ...pending, status: "CONFIRMED", updatedAt: now, updatedBy: null }),
  );
  transaction.create(
    scope.doc("auditLogs", `${messageId}-remarcado`),
    toStored("auditLogs", {
      id: `${messageId}-remarcado`,
      organizationId: appointment.organizationId,
      actorType: "SYSTEM",
      actorId: null,
      actorName: "Automação do Atendara",
      action: "APPOINTMENT_UPDATED",
      resource: { type: "appointment", id: appointment.id },
      summary: "Remarcado pela própria pessoa, pelo WhatsApp, dentro da política da organização.",
      metadata: { from: appointment.startsAt, to: confirmacao.appointment.startsAt, channel: "WHATSAPP" },
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    }),
  );
  return { outcome: "RESCHEDULE_CONFIRMED" };
}

/**
 * Fuso da organizacao em minutos. Sem biblioteca de fuso no backend: o que
 * existe hoje e o horario de Brasilia, e qualquer outro cai no mesmo valor ate
 * a 13.7, que traz a agenda externa e com ela a conversao completa.
 */
function offsetOfTimezone(timezone) {
  return timezone === "UTC" ? 0 : -180;
}
