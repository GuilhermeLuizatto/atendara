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
  whatsappConversationId,
} from "./generated/automation-inbound.js";
import {
  INBOUND_CONFIRMATION_NOTE,
  INBOUND_OPT_OUT_NOTE,
  INBOUND_PREVIEW_LENGTH,
} from "./generated/inbound-config.js";
import { decide } from "./generated/decision-engine.js";
import { decisionInputPreview } from "./generated/privacy-decision-preview.js";
import {
  confirmReschedule,
  decideReschedule,
  policyOf,
  selfServiceReschedulesOf,
} from "./generated/agenda-reschedule.js";
import { RESCHEDULE_REFUSAL_LABELS } from "./generated/reschedule-config.js";
import { rescheduleHoldEndsAt } from "./generated/reschedule-config.js";
import {
  firstAvailableSlots,
  isSlotFree,
} from "./generated/agenda-availability.js";
import { agendaSelfServicePolicyOf } from "./generated/agenda-self-service-config.js";
import { isBusySnapshotFresh } from "./generated/agenda-calendar.js";
import {
  activeConsentChannels,
  applyConsentChanges,
  plannedConsentChanges,
} from "./generated/notifications-consent-record.js";
import { withOrganizationDefaults } from "./generated/organization-config.js";
import { getProfession, isProfessionId } from "./generated/professions.js";
import { ROLE_PERMISSIONS } from "./generated/permissions.js";
import { messagePath, paths } from "./generated/paths.js";
import { planConversationReply } from "./generated/automation-conversation-replies.js";
import {
  assistantReplySchedule,
  hasActiveAppointment,
} from "./generated/automation-assistant-availability.js";
import { scheduleTask } from "./automation-queue.js";
import { verifyBridgeSignature } from "./n8n-bridge.js";
import { runAs } from "./service-accounts.js";
import { routeContact } from "./generated/leads-routing.js";
import {
  grantLeadConsent,
  isLeadConsentAcceptance,
  leadConsentProblem,
  leadRecipient,
  leadStatusAfterInbound,
  withdrawLeadConsent,
} from "./generated/leads-lifecycle.js";
import {
  LEAD_CONSENT_NOTE,
  LEAD_CREATED_NOTE,
  ROUTING_QUEUE_LABELS,
  ROUTING_REASON_LABELS,
} from "./generated/leads-config.js";
import { maskPhone } from "./generated/notifications-contacts.js";
import {
  cancelPendingAutomation,
  leadIdFor,
  newLeadConversationId,
  pendingAutomationOf,
  soleActiveProfessionalId,
} from "./leads.js";
import { classifyWithGemini, geminiEnabledFor } from "./gemini.js";
import { materializeSeededRules } from "./generated/system-rules-config.js";

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
 * **dentro daquela organizacao**. Numero desconhecido vira lead daquela
 * organizacao — e **nunca** e procurado em outra: fazer isso contaria a uma
 * clinica que aquela pessoa e atendida na outra. Lead nao vira cliente sozinho.
 */

const REGION = "southamerica-east1";
const SECRETS = ["N8N_CALLBACK_SECRET", "META_APP_SECRET", "GEMINI_API_KEY"];

const db = () => getFirestore();

function stored(collection, snapshot) {
  return snapshot?.exists
    ? fromStored(collection, snapshot.id, snapshot.data())
    : null;
}

/** Assinatura da Meta: `sha256=` mais o HMAC do corpo BRUTO com o App Secret. */
export function verifyMetaSignature(appSecret, rawBody, header) {
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  if (expected.length !== header.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(header, "utf8"),
    );
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
  const sender = fromStored(
    "messagingSenders",
    found.docs[0].id,
    found.docs[0].data(),
  );
  return sender.status === "APPROVED" &&
    sender.channel === "WHATSAPP" &&
    sender.providerId === "N8N_BRIDGE"
    ? sender
    : null;
}

/**
 * A pessoa, procurada SO dentro daquela organizacao. Dois cadastros com o mesmo
 * numero sao contato conhecido, mas ambiguo: nao viram lead, porque a pessoa
 * ja e cliente — so nao se sabe qual dos cadastros.
 */
async function clientOfPhone(transaction, organizationId, phone) {
  const found = await db()
    .collection(paths.collection(organizationId, "clients"))
    .where("phone", "==", phone)
    .limit(2);
  const snapshot = await transaction.get(found);
  return {
    client: snapshot.size === 1 ? stored("clients", snapshot.docs[0]) : null,
    ambiguous: snapshot.size > 1,
  };
}

/**
 * De qual conversa e a mensagem: do cadastro, do lead ou — so no caso ambiguo
 * de dois cadastros com o mesmo numero — a conversa sem vinculo de antes.
 * `null` e lead novo, que ainda nao tem conversa.
 */
function conversationOfContact({ client, leadId, lead, phone }) {
  if (client) return whatsappConversationId(client.id, phone);
  if (lead) return lead.conversationId;
  if (leadId) return null;
  return whatsappConversationId(null, phone);
}

/**
 * Classificação semântica (fase 4), pedida antes da transação. É só
 * pré-leitura: a transação relê pessoa, conversa e travas, e o resultado só é
 * usado se a conversa e a profissão continuarem as mesmas.
 */
async function semanticBeforeTransaction(ctx) {
  const { event, firestore, scope, organizationId, phone, messageId, now } =
    ctx;
  const found = await firestore
    .collection(paths.collection(organizationId, "clients"))
    .where("phone", "==", phone)
    .limit(2)
    .get();
  const client = found.size === 1 ? stored("clients", found.docs[0]) : null;
  const leadId = found.size === 0 ? leadIdFor(organizationId, phone) : null;
  const lead = leadId
    ? stored("leads", await scope.doc("leads", leadId).get())
    : null;
  const conversationId = conversationOfContact({ client, leadId, lead, phone });

  const [orgSnapshot, previousSnapshot, existingSnapshot] = await Promise.all([
    firestore.doc(paths.organization(organizationId)).get(),
    conversationId ? scope.doc("conversations", conversationId).get() : null,
    conversationId
      ? firestore
          .doc(messagePath(organizationId, conversationId, messageId))
          .get()
      : { exists: false },
  ]);
  const org = stored("organizations", orgSnapshot);
  const previous = stored("conversations", previousSnapshot);
  const kind = decideInbound({
    event,
    knownProviderMessageIds: existingSnapshot.exists
      ? [event.providerMessageId]
      : [],
    lastInboundAt: previous?.lastInboundAt ?? previous?.lastMessageAt ?? null,
  }).kind;
  // Numero puro e escolha de horario oferecido, nao texto para classificar.
  if (
    kind !== "CLASSIFY" ||
    !org ||
    org.deletion ||
    !isProfessionId(org.primaryProfession) ||
    previous?.escalated ||
    /^\s*\d+\s*$/.test(event.text)
  )
    return null;

  const organization = withOrganizationDefaults(
    org,
    organizationId,
    org.primaryProfession,
    now,
  );
  const result = await classifyWithGemini({
    text: event.text,
    profession: getProfession(org.primaryProfession),
    organizationId,
    enabled: organization.settings.ai.enabled,
  });
  return {
    contactKey: client?.id ?? leadId ?? conversationId,
    profession: org.primaryProfession,
    result,
  };
}

// A fila é local à tentativa: todos os ramos concluem as leituras antes de
// enviar escritas ao SDK, e uma repetição da transação refaz tudo do zero.
async function withDeferredWrites(transaction, operation) {
  const writes = [];
  const result = await operation({
    get: (reference) => transaction.get(reference),
    create: (...args) => writes.push(() => transaction.create(...args)),
    set: (...args) => writes.push(() => transaction.set(...args)),
  });
  for (const write of writes) write();
  return result;
}

function preview(text) {
  return text.length > INBOUND_PREVIEW_LENGTH
    ? `${text.slice(0, INBOUND_PREVIEW_LENGTH - 1)}…`
    : text;
}

/**
 * Grava o que chegou. Mensagem, conversa e consequencia na MESMA transacao: a
 * mensagem nunca existe sem a conversa, e a retirada de consentimento nunca
 * existe sem a mensagem que a pediu.
 */
export async function applyInboundEvent(event, deps = {}) {
  const { clock = () => new Date().toISOString(), enqueue } = deps;
  const now = clock();

  const sender = await organizationOfSender(event.providerSenderId);
  if (!sender) return { outcome: "UNKNOWN_SENDER" };

  const organizationId = sender.organizationId;
  const phone = normalizeInboundPhone(event.from);
  if (!phone) return { outcome: "INVALID_PHONE" };
  if (sender.mode === "TEST" && !sender.testRecipients?.includes(phone))
    return { outcome: "TEST_CONTACT_NOT_ALLOWED" };

  const firestore = db();
  const scope = {
    doc: (collection, id) =>
      firestore.doc(paths.document(organizationId, collection, id)),
  };
  const messageId = inboundMessageId(event.providerMessageId);

  // Rede fora da transação: uma repetição do Firestore não pode cobrar outra inferência.
  // O estado e as travas são lidos novamente dentro da transação antes da decisão.
  const semantic =
    event.kind === "TEXT" && geminiEnabledFor(organizationId)
      ? await semanticBeforeTransaction({
          event,
          firestore,
          scope,
          organizationId,
          phone,
          messageId,
          now,
        })
      : null;

  const result = await firestore.runTransaction((realTransaction) =>
    withDeferredWrites(realTransaction, async (transaction) => {
      // A leitura participa da transação para não sobrescrever consentimento ou
      // cadastro alterado pela equipe enquanto a mensagem está sendo processada.
      const { client, ambiguous } = await clientOfPhone(
        transaction,
        organizationId,
        phone,
      );
      // Sem cadastro, o contato e um lead DESTA organizacao. O id deriva do
      // telefone: a reentrega encontra o mesmo lead, e nunca cria outro.
      const leadId =
        !client && !ambiguous ? leadIdFor(organizationId, phone) : null;
      const lead = leadId
        ? stored("leads", await transaction.get(scope.doc("leads", leadId)))
        : null;
      const conversationId =
        conversationOfContact({ client, leadId, lead, phone }) ??
        newLeadConversationId();
      const contactKey = client?.id ?? leadId ?? conversationId;
      const messageRef = firestore.doc(
        messagePath(organizationId, conversationId, messageId),
      );
      const conversation = stored(
        "conversations",
        await transaction.get(scope.doc("conversations", conversationId)),
      );
      let professionalId =
        conversation?.professionalId ??
        lead?.professionalId ??
        (client?.assignedProfessionalIds?.length === 1
          ? client.assignedProfessionalIds[0]
          : null);
      if (!professionalId && leadId && !lead) {
        professionalId = await soleActiveProfessionalId(
          transaction,
          firestore,
          organizationId,
        );
      }
      // Campos que so a equipe e a tomada humana escrevem: a mensagem que
      // chega regrava a conversa, mas nunca os apaga.
      const carried = {
        humanTakeoverAt: conversation?.humanTakeoverAt ?? null,
        humanTakeoverSource: conversation?.humanTakeoverSource ?? null,
        automationResumeAuditId: conversation?.automationResumeAuditId ?? null,
        ...(leadId ? { leadId } : {}),
      };
      const leadConsent = lead?.notificationConsent ?? null;
      const existing = await transaction.get(messageRef);
      // Compatibilidade com a versão que gravava na raiz e retirava pontuação.
      // Conferir o id original impede que colisões antigas descartem mensagens.
      const legacyId = `wa-${event.providerMessageId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 96)}`;
      const legacy = stored(
        "messages",
        await transaction.get(scope.doc("messages", legacyId)),
      );
      // Leituras antes de qualquer escrita: e exigencia da transacao, e tambem o
      // que garante que a decisao use o estado do mesmo instante.
      const organizationSnapshot = await transaction.get(
        firestore.doc(paths.organization(organizationId)),
      );
      const rules = (
        await transaction.get(
          firestore.collection(paths.collection(organizationId, "aiRules")),
        )
      ).docs.map((document) => stored("aiRules", document));
      const pendingRaw = stored(
        "rescheduleRequests",
        await transaction.get(scope.doc("rescheduleRequests", conversationId)),
      );
      // Reserva vencida nao vale escolha: o horario ja voltou a ser de quem quiser.
      const pending =
        pendingRaw &&
        pendingRaw.status === "OFFERED" &&
        Date.parse(now) <= Date.parse(pendingRaw.holdEndsAt)
          ? pendingRaw
          : null;
      const bookingRaw = stored(
        "bookingRequests",
        await transaction.get(scope.doc("bookingRequests", conversationId)),
      );
      const pendingBooking =
        bookingRaw &&
        bookingRaw.status === "OFFERED" &&
        Date.parse(now) <= Date.parse(bookingRaw.holdEndsAt)
          ? bookingRaw
          : null;

      // Resposta da assistente, planejada nesta transacao. Tudo o que ela
      // confere ja foi lido acima: organizacao, cadastro, conversa e remetente.
      // Lead so recebe resposta com consentimento vigente dado por ele mesmo;
      // sem isso, nada e planejado e o motivo volta no resultado.
      const replyTo = (reply) => {
        const consentProblem = leadId ? leadConsentProblem(leadConsent) : null;
        if (consentProblem) return { kind: "SKIPPED", reason: consentProblem };
        return planReply({
          transaction,
          scope,
          organizationId,
          organizationSnapshot,
          client:
            client ??
            (leadId
              ? leadRecipient({
                  id: leadId,
                  phone,
                  notificationConsent: leadConsent,
                })
              : null),
          leadId,
          sender,
          conversation,
          sentAt: event.sentAt,
          messageId,
          now,
          ...reply,
        });
      };

      /**
       * O lead como fica depois desta mensagem. Mensagem atrasada nao muda
       * situacao, fila nem atencao; risco, uma vez visto, so sai pela equipe.
       */
      const writeLead = ({ routing, attention, requiresHuman, consent }) => {
        if (!leadId) return null;
        const newer =
          !lead || Date.parse(event.sentAt) > Date.parse(lead.lastContactAt);
        const status = leadStatusAfterInbound(lead?.status ?? null, {
          requiresHuman,
          newer,
        });
        const keep =
          lead && (!routing || !newer || lead.attention === "CRITICAL");
        const next = {
          id: leadId,
          organizationId,
          source: "WHATSAPP",
          conversationId,
          phone,
          contactHint: maskPhone(phone),
          professionalId: lead?.professionalId ?? professionalId,
          status,
          queue: keep ? lead.queue : (routing?.queue ?? "HUMAN_REVIEW"),
          routingReason: keep
            ? lead.routingReason
            : (routing?.reason ?? "MISSING_CONTEXT"),
          attention: keep ? lead.attention : (attention ?? "NORMAL"),
          firstContactAt: lead?.firstContactAt ?? event.sentAt,
          lastContactAt: newer ? event.sentAt : lead.lastContactAt,
          statusChangedAt:
            lead && lead.status === status ? lead.statusChangedAt : now,
          notificationConsent:
            consent === undefined ? leadConsent : (consent ?? null),
          createdAt: lead?.createdAt ?? now,
          createdBy: null,
          updatedAt: now,
          updatedBy: null,
        };
        transaction.set(scope.doc("leads", leadId), toStored("leads", next));
        if (!lead) {
          transaction.create(
            scope.doc("auditLogs", `${messageId}-lead`),
            toStored("auditLogs", {
              id: `${messageId}-lead`,
              organizationId,
              actorType: "SYSTEM",
              actorId: null,
              actorName: "Automação do Atendara",
              action: "CREATE",
              resource: { type: "lead", id: leadId },
              summary: LEAD_CREATED_NOTE,
              metadata: { channel: "WHATSAPP", messageId },
              occurredAt: now,
              createdAt: now,
              createdBy: null,
              updatedAt: now,
              updatedBy: null,
            }),
          );
        }
        return {
          lead: next,
          created: !lead,
          reopened: lead?.status === "CLOSED" && status !== "CLOSED",
        };
      };

      const decision = decideInbound({
        event,
        knownProviderMessageIds:
          existing.exists ||
          legacy?.providerMessageId === event.providerMessageId
            ? [event.providerMessageId]
            : [],
        lastInboundAt:
          conversation?.lastInboundAt ?? conversation?.lastMessageAt ?? null,
      });
      if (decision.kind === "DUPLICATE")
        return { outcome: "DUPLICATE", organizationId };

      const body =
        event.kind === "TEXT"
          ? event.text
          : event.button === "CONFIRM"
            ? "Confirmar"
            : "Remarcar";
      const olderThanPreview = Boolean(
        conversation &&
        Date.parse(event.sentAt) < Date.parse(conversation.lastMessageAt),
      );

      transaction.create(
        messageRef,
        toStored("messages", {
          id: messageId,
          organizationId,
          conversationId,
          clientId: client?.id ?? null,
          professionalId,
          direction: "INBOUND",
          authorType: "CLIENT",
          authorName: client?.fullName ?? "Contato não identificado",
          channel: "WHATSAPP",
          body,
          sentAt: event.sentAt,
          readAt: null,
          classification: null,
          classificationConfidence: null,
          aiDecisionId: null,
          providerMessageId: event.providerMessageId,
          createdAt: now,
          createdBy: null,
          updatedAt: now,
          updatedBy: null,
        }),
      );

      // Mensagem atrasada e gravada — a conversa e prova —, mas nao muda o resumo
      // nem a atencao: a ordem de chegada nao reescreve o que ja se sabe.
      if (!olderThanPreview) {
        transaction.set(
          scope.doc("conversations", conversationId),
          toStored("conversations", {
            id: conversationId,
            organizationId,
            clientId: client?.id ?? null,
            clientName: client?.fullName ?? "Contato não identificado",
            professionalId,
            channel: "WHATSAPP",
            status: conversation?.escalated ? "WAITING_PROFESSIONAL" : "OPEN",
            attention: conversation?.attention ?? "NORMAL",
            lastClassification: conversation?.lastClassification ?? null,
            lastMessagePreview: preview(body),
            lastMessageAt: event.sentAt,
            lastInboundAt: event.sentAt,
            unreadCount: (conversation?.unreadCount ?? 0) + 1,
            escalated: conversation?.escalated ?? false,
            escalationReason: conversation?.escalationReason ?? null,
            ...carried,
            // A janela de texto livre que a propria pessoa abriu.
            inboundWindowEndsAt: inboundWindowEndsAt(event.sentAt),
            createdAt: conversation?.createdAt ?? now,
            createdBy: null,
            updatedAt: now,
            updatedBy: null,
          }),
        );
      }

      if (olderThanPreview) {
        transaction.set(
          scope.doc("conversations", conversationId),
          toStored("conversations", {
            unreadCount: (conversation.unreadCount ?? 0) + 1,
            updatedAt: now,
            updatedBy: null,
          }),
          { merge: true },
        );
      }

      // Autorizacao explicita do lead, pela frase que nomeia o canal. E ato da
      // propria pessoa, nao pergunta: nao vai ao motor nem gera resposta.
      if (
        leadId &&
        event.kind === "TEXT" &&
        decision.kind !== "OPT_OUT" &&
        isLeadConsentAcceptance(event.text)
      ) {
        const consent = grantLeadConsent(leadConsent, now);
        writeLead({ routing: null, requiresHuman: true, consent });
        transaction.create(
          scope.doc("auditLogs", `${messageId}-consent`),
          toStored("auditLogs", {
            id: `${messageId}-consent`,
            organizationId,
            actorType: "SYSTEM",
            actorId: null,
            actorName: "Automação do Atendara",
            action: "UPDATE",
            resource: { type: "lead", id: leadId },
            summary: LEAD_CONSENT_NOTE,
            metadata: {
              channel: "WHATSAPP",
              messageId,
              consent: {
                act: "GRANTED",
                textVersion: consent.channels.WHATSAPP.at(-1).textVersion,
              },
            },
            occurredAt: now,
            createdAt: now,
            createdBy: null,
            updatedAt: now,
            updatedBy: null,
          }),
        );
        return {
          outcome: "LEAD_CONSENT_GRANTED",
          organizationId,
          conversationId,
          clientId: null,
          leadId,
        };
      }

      // Saida vale na hora: o consentimento e retirado e tudo o que ainda
      // esperava a vez na fila e cancelado na mesma transacao.
      if (decision.kind === "OPT_OUT" && (client || leadId)) {
        const pendingAutomation = await pendingAutomationOf({
          transaction,
          firestore,
          scope,
          organizationId,
          field: client ? "clientId" : "leadId",
          id: client?.id ?? leadId,
        });
        const cancelled = cancelPendingAutomation({
          transaction,
          scope,
          ...pendingAutomation,
          now,
          code: "CONSENT_REVOKED",
        });
        if (!olderThanPreview) {
          transaction.set(
            scope.doc("conversations", conversationId),
            { pendingAssistantTaskId: null },
            { merge: true },
          );
        }
        if (!client) {
          writeLead({
            routing: null,
            requiresHuman: false,
            consent: withdrawLeadConsent(leadConsent, now),
          });
          transaction.create(
            scope.doc("auditLogs", `${messageId}-consent`),
            toStored("auditLogs", {
              id: `${messageId}-consent`,
              organizationId,
              actorType: "SYSTEM",
              actorId: null,
              actorName: "Automação do Atendara",
              action: "UPDATE",
              resource: { type: "lead", id: leadId },
              summary: INBOUND_OPT_OUT_NOTE,
              metadata: { channel: "WHATSAPP", messageId, cancelled },
              occurredAt: now,
              createdAt: now,
              createdBy: null,
              updatedAt: now,
              updatedBy: null,
            }),
          );
          return {
            outcome: "OPT_OUT",
            organizationId,
            conversationId,
            clientId: null,
            leadId,
            cancelled,
          };
        }
        const changes = plannedConsentChanges(
          client.notificationConsent,
          // Retira so o WhatsApp: quem pediu para parar no WhatsApp nao pediu
          // para parar no e-mail.
          activeConsentChannels(client.notificationConsent).filter(
            (channel) => channel !== "WHATSAPP",
          ),
        );
        const consent = applyConsentChanges(
          client.notificationConsent,
          changes,
          {
            at: now,
            // A propria pessoa, pelo canal: nao e a equipe anotando.
            recordedBy: { kind: "SUBJECT", userId: null },
            medium: "MESSAGE",
          },
          { textVersion: null, subjectIsMinor: false, legalGuardian: null },
        );

        transaction.set(
          scope.doc("clients", client.id),
          toStored("clients", {
            notificationConsent: consent,
            updatedAt: now,
            updatedBy: null,
          }),
          { merge: true },
        );
        transaction.create(
          scope.doc("auditLogs", `${messageId}-consent`),
          toStored("auditLogs", {
            id: `${messageId}-consent`,
            organizationId,
            actorType: "SYSTEM",
            actorId: null,
            actorName: "Automação do Atendara",
            action: "UPDATE",
            resource: { type: "client", id: client.id },
            summary: INBOUND_OPT_OUT_NOTE,
            metadata: { channel: "WHATSAPP", messageId, cancelled },
            occurredAt: now,
            createdAt: now,
            createdBy: null,
            updatedAt: now,
            updatedBy: null,
          }),
        );
        return { outcome: "OPT_OUT", organizationId, conversationId, cancelled };
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
            action: "CREATE",
            resource: { type: "message", id: messageId },
            summary: INBOUND_CONFIRMATION_NOTE,
            metadata: { channel: "WHATSAPP", messageId, button: "CONFIRM" },
            occurredAt: now,
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
          replyTo,
        });
        return {
          outcome: resultado.outcome,
          organizationId,
          conversationId,
          clientId: client?.id ?? null,
          reason: resultado.reason ?? null,
          ...replyOutcome(resultado.reply),
        };
      }

      // Escolha de um dos horarios oferecidos: "1", "2", "3". A conferencia de
      // que o horario CONTINUA livre acontece aqui dentro, na mesma transacao —
      // entre oferecer e escolher passa gente marcando.
      const bookingChoiceActive = Boolean(
        pendingBooking &&
        (!pending ||
          Date.parse(pendingBooking.offeredAt) >=
            Date.parse(pending.offeredAt)),
      );
      if (
        decision.kind === "CLASSIFY" &&
        pendingBooking &&
        bookingChoiceActive &&
        event.kind === "TEXT"
      ) {
        const escolha = Number(event.text.trim());
        if (
          Number.isInteger(escolha) &&
          escolha >= 1 &&
          escolha <= pendingBooking.slots.length
        ) {
          const resultado = await confirmBookingSlot({
            transaction,
            scope,
            firestore,
            organizationId,
            conversationId,
            pending: pendingBooking,
            chosen: pendingBooking.slots[escolha - 1],
            client,
            organizationSnapshot,
            messageId,
            now,
            replyTo,
          });
          return {
            outcome: resultado.outcome,
            organizationId,
            conversationId,
            clientId: client?.id ?? null,
            reason: resultado.reason ?? null,
            ...replyOutcome(resultado.reply),
          };
        }
      }

      if (
        decision.kind === "CLASSIFY" &&
        pending &&
        !bookingChoiceActive &&
        event.kind === "TEXT"
      ) {
        const escolha = Number(event.text.trim());
        if (
          Number.isInteger(escolha) &&
          escolha >= 1 &&
          escolha <= pending.slots.length
        ) {
          const resultado = await confirmChosenSlot({
            transaction,
            scope,
            firestore,
            organizationId,
            conversationId,
            pending,
            chosen: pending.slots[escolha - 1],
            appointment: stored(
              "appointments",
              await transaction.get(
                scope.doc("appointments", pending.appointmentId),
              ),
            ),
            messageId,
            now,
            replyTo,
          });
          return {
            outcome: resultado.outcome,
            organizationId,
            conversationId,
            clientId: client?.id ?? null,
            reason: resultado.reason ?? null,
            ...replyOutcome(resultado.reply),
          };
        }
      }

      // Texto comum vai ao motor: classificacao, regras, contexto e permissao.
      // Aqui NAO se responde — so se registra o que seria feito. Resposta que
      // sai e tarefa da fila, com as travas da regra 11; mandar daqui pularia
      // consentimento, canal permitido pela profissao e remetente comprovado.
      if (
        event.kind === "TEXT" &&
        (decision.kind === "CLASSIFY" || decision.kind === "OUT_OF_ORDER")
      ) {
        const rawOrganization = stored("organizations", organizationSnapshot);
        const profession =
          rawOrganization && isProfessionId(rawOrganization.primaryProfession)
            ? getProfession(rawOrganization.primaryProfession)
            : null;

        if (profession) {
          const organization = withOrganizationDefaults(
            rawOrganization,
            organizationId,
            rawOrganization.primaryProfession,
            now,
          );
          const seeds = materializeSeededRules(organizationId, profession, now);
          const seedIds = new Set(seeds.map((rule) => rule.id));
          // O resultado semântico foi pedido antes da transação; só vale se a
          // conversa e a profissão ainda forem as mesmas nesta leitura.
          const semanticResult =
            semantic &&
            semantic.contactKey === contactKey &&
            semantic.profession === rawOrganization.primaryProfession
              ? semantic.result
              : null;
          const decided = decide({
            text: event.text,
            profession,
            organization,
            rules: [...seeds, ...rules.filter((rule) => !seedIds.has(rule.id))],
            channel: "WHATSAPP",
            client: client
              ? {
                  modality: client.preferredModality ?? null,
                  status: client.status ?? null,
                  // O webhook nao le o financeiro: desconhecido, nao "sem saldo".
                  hasOutstandingBalance: null,
                }
              : null,
            semanticClassification: semanticResult?.classification,
            now: new Date(now),
            professionalId,
            humanHandoff: conversation?.escalated ?? false,
            // A automacao age com as permissoes da propria organizacao, nunca com
            // as de uma pessoa: decisao de robo nao herda papel de ninguem.
            permissions: ROLE_PERMISSIONS.OWNER,
          });

          const decisionId = `${messageId}-decision`;
          // As rotinas de agenda mexem em atendimento e financeiro de um
          // cadastro: lead nao tem nenhum dos dois, e vai para a fila da agenda.
          const naturalLanguageReschedule =
            Boolean(client) &&
            decided.action === "AUTO_RESPONSE" &&
            decided.trace.classification.classification === "ADMINISTRATIVE" &&
            decided.trace.classification.intent === "RESCHEDULING";
          const naturalLanguageBooking =
            Boolean(client) &&
            decided.action === "AUTO_RESPONSE" &&
            decided.trace.classification.classification === "ADMINISTRATIVE" &&
            decided.trace.classification.intent === "SCHEDULING";
          const naturalLanguageCancellation =
            Boolean(client) &&
            decided.action === "AUTO_RESPONSE" &&
            decided.trace.classification.classification === "ADMINISTRATIVE" &&
            decided.trace.classification.intent === "CANCELLATION";
          let routineResult = null;
          let administrativeReply = null;
          let replyTrigger = null;
          if (naturalLanguageReschedule) {
            // O texto entra no mesmo fluxo transacional do botão: política,
            // agenda e concorrência continuam com uma única fonte de verdade.
            routineResult = await handleRescheduleRequest({
              transaction,
              scope,
              firestore,
              organizationId,
              organizationSnapshot,
              conversationId,
              client,
              messageId,
              now,
              replyTo,
            });
          } else if (naturalLanguageBooking) {
            routineResult = await handleBookingRequest({
              transaction,
              scope,
              firestore,
              organizationId,
              organizationSnapshot,
              conversationId,
              client,
              professionalId,
              messageId,
              now,
              replyTo,
            });
          } else if (naturalLanguageCancellation) {
            routineResult = await handleCancellationRequest({
              transaction,
              scope,
              firestore,
              organizationId,
              organizationSnapshot,
              conversationId,
              client,
              messageId,
              now,
              replyTo,
            });
          } else if (
            decided.action === "AUTO_RESPONSE" &&
            decided.responseText
          ) {
            const recentAppointments = professionalId
              ? (
                  await transaction.get(
                    firestore
                      .collection(
                        paths.collection(organizationId, "appointments"),
                      )
                      .where("professionalId", "==", professionalId)
                      .where(
                        "startsAt",
                        "<=",
                        Timestamp.fromDate(new Date(now)),
                      )
                      .orderBy("startsAt", "desc")
                      .limit(20),
                  )
                ).docs.map((document) => stored("appointments", document))
              : [];
            const timing = assistantReplySchedule({
              organization,
              now,
              activeAppointment: hasActiveAppointment(
                recentAppointments,
                professionalId,
                now,
              ),
            });
            replyTrigger = timing.trigger;
            administrativeReply = replyTo({
              event: "ADMINISTRATIVE_REPLY",
              stage: "REQUEST",
              appointment: null,
              professionalId,
              scheduledFor: timing.scheduledFor,
              sourceDecisionId: decisionId,
              responseText: decided.responseText,
            });
            if (administrativeReply.kind !== "PLANNED") {
              decided.action = "SUGGEST_RESPONSE";
              decided.reason = `Resposta administrativa preparada, mas o envio automático foi bloqueado: ${administrativeReply.reason}.`;
            }
          }
          transaction.set(
            messageRef,
            {
              classification: decided.classification,
              classificationConfidence: decided.confidence,
              aiDecisionId: decisionId,
            },
            { merge: true },
          );
          transaction.create(
            scope.doc("aiDecisions", decisionId),
            toStored("aiDecisions", {
              id: decisionId,
              organizationId,
              conversationId,
              messageId,
              clientId: client?.id ?? null,
              professionalId,
              inputPreview: decisionInputPreview(
                event.text,
                profession.sensitiveDataProfile,
              ),
              classification: decided.trace.classification.classification,
              confidence: decided.trace.classification.confidence,
              appliedRules: decided.appliedRules ?? [],
              action: decided.action,
              responseText: decided.responseText ?? null,
              reason: decided.reason,
              attention: decided.attention,
              escalated:
                decided.escalated ??
                decided.action === "ESCALATE_TO_PROFESSIONAL",
              engineVersion: decided.engineVersion ?? "13.5",
              decidedAt: now,
              latencyMs: semanticResult?.metadata.latencyMs ?? 0,
              ...(semanticResult
                ? { classifier: semanticResult.metadata }
                : {}),
              createdAt: now,
              createdBy: null,
              updatedAt: now,
              updatedBy: null,
            }),
          );

          const retainsCritical =
            conversation?.escalated && conversation.attention === "CRITICAL";
          const routineEscalated =
            routineResult?.outcome?.endsWith("_ESCALATED") ?? false;
          const mustEscalate =
            routineEscalated ||
            decided.escalated ||
            conversation?.escalated ||
            false;
          const plannedReply = routineResult?.reply ?? administrativeReply;
          if (!olderThanPreview)
            transaction.set(
              scope.doc("conversations", conversationId),
              toStored("conversations", {
                id: conversationId,
                organizationId,
                clientId: client?.id ?? null,
                clientName: client?.fullName ?? "Contato não identificado",
                professionalId,
                channel: "WHATSAPP",
                status: mustEscalate ? "WAITING_PROFESSIONAL" : "OPEN",
                attention: retainsCritical
                  ? "CRITICAL"
                  : routineEscalated
                    ? "HIGH"
                    : decided.attention,
                lastClassification: decided.trace.classification.classification,
                lastMessagePreview: preview(body),
                lastMessageAt: event.sentAt,
                lastInboundAt: event.sentAt,
                unreadCount: (conversation?.unreadCount ?? 0) + 1,
                escalated: mustEscalate,
                escalationReason: retainsCritical
                  ? conversation.escalationReason
                  : mustEscalate
                    ? (routineResult?.reason ?? decided.reason)
                    : null,
                ...carried,
                pendingAssistantTaskId:
                  plannedReply?.kind === "PLANNED"
                    ? plannedReply.task.id
                    : null,
                inboundWindowEndsAt: inboundWindowEndsAt(event.sentAt),
                createdAt: conversation?.createdAt ?? now,
                createdBy: null,
                updatedAt: now,
                updatedBy: null,
              }),
            );
          else if (decided.attention === "CRITICAL")
            transaction.set(
              scope.doc("conversations", conversationId),
              {
                status: "WAITING_PROFESSIONAL",
                attention: "CRITICAL",
                escalated: true,
                escalationReason: decided.reason,
              },
              { merge: true },
            );

          const needsTeam =
            decided.escalated || decided.action === "SUGGEST_RESPONSE";
          // Encaminhamento do lead: a fila sai da classificacao ja feita, e
          // "precisa de gente" e tudo o que a Dara nao vai responder agora.
          const routing = leadId
            ? routeContact({
                classification: decided.trace.classification,
                confidenceThreshold:
                  organization.settings.ai.autoResponseConfidenceThreshold,
              })
            : null;
          const leadWrite = writeLead({
            routing,
            attention: decided.attention,
            requiresHuman:
              Boolean(routing?.requiresHuman) ||
              plannedReply?.kind !== "PLANNED",
          });
          if (
            leadWrite &&
            (needsTeam || leadWrite.created || leadWrite.reopened)
          ) {
            const alertId = `${messageId}-alerta`;
            const current = leadWrite.lead;
            const withoutConsent = leadConsentProblem(
              current.notificationConsent,
            );
            transaction.create(
              scope.doc("notifications", alertId),
              toStored("notifications", {
                id: alertId,
                organizationId,
                type:
                  decided.classification === "POSSIBLE_RISK"
                    ? "POSSIBLE_RISK_DETECTED"
                    : "NEW_LEAD",
                status: "UNREAD",
                priority:
                  current.attention === "CRITICAL"
                    ? "CRITICAL"
                    : needsTeam || routing?.requiresHuman
                      ? "HIGH"
                      : "NORMAL",
                title: leadWrite.created
                  ? "Novo contato pelo WhatsApp"
                  : "Contato sem cadastro aguarda a equipe",
                // Sem texto da mensagem: o alerta diz a fila e o motivo, e a
                // conversa e o unico lugar do que foi dito.
                body: `Encaminhado para ${ROUTING_QUEUE_LABELS[current.queue]}. Motivo: ${ROUTING_REASON_LABELS[current.routingReason]}.${withoutConsent ? " Sem consentimento vigente: a Dara não responde a este contato." : ""}`,
                target: { type: "conversation", id: conversationId },
                professionalId,
                channels: ["DASHBOARD"],
                aiDecisionId: decisionId,
                acknowledgedAt: null,
                acknowledgedBy: null,
                createdAt: now,
                createdBy: null,
                updatedAt: now,
                updatedBy: null,
              }),
            );
          }

          // Risco vira alerta CRITICAL para gente, e nunca resposta automatica: a
          // trava vive em CLASSIFICATION_META e e o motor que a aplica.
          if (!leadWrite && needsTeam) {
            const alertId = `${messageId}-alerta`;
            transaction.create(
              scope.doc("notifications", alertId),
              toStored("notifications", {
                id: alertId,
                organizationId,
                type:
                  decided.classification === "POSSIBLE_RISK"
                    ? "POSSIBLE_RISK_DETECTED"
                    : "CLIENT_WAITING",
                status: "UNREAD",
                priority: decided.attention,
                title: "Mensagem que precisa de atenção humana",
                body:
                  decided.classification === "POSSIBLE_RISK"
                    ? "Uma mensagem recebida foi classificada como possível risco. Nenhuma resposta automática foi enviada."
                    : "Uma mensagem recebida aguarda análise da equipe. Nenhuma resposta automática foi enviada.",
                target: { type: "conversation", id: conversationId },
                professionalId,
                channels: ["DASHBOARD"],
                aiDecisionId: decisionId,
                acknowledgedAt: null,
                acknowledgedBy: null,
                createdAt: now,
                createdBy: null,
                updatedAt: now,
                updatedBy: null,
              }),
            );
          }

          if (routineResult) {
            return {
              outcome: routineResult.outcome,
              organizationId,
              conversationId,
              clientId: client?.id ?? null,
              classification: decided.trace.classification.classification,
              action: decided.action,
              attention: routineEscalated ? "HIGH" : decided.attention,
              reason: routineResult.reason ?? null,
              ...replyOutcome(routineResult.reply),
            };
          }

          return {
            outcome:
              decision.kind === "OUT_OF_ORDER" ? "OUT_OF_ORDER" : "CLASSIFIED",
            organizationId,
            conversationId,
            clientId: client?.id ?? null,
            ...(leadWrite
              ? {
                  leadId,
                  queue: leadWrite.lead.queue,
                  leadStatus: leadWrite.lead.status,
                }
              : {}),
            classification: decided.trace.classification.classification,
            action: decided.action,
            attention: decided.attention,
            replyTrigger,
            ...replyOutcome(administrativeReply),
          };
        }
      }

      // Botao e mensagem sem texto a classificar: o lead fica registrado, para
      // a equipe, mesmo sem decisao do motor.
      const leadWrite = writeLead({ routing: null, requiresHuman: true });
      return {
        outcome: decision.kind,
        organizationId,
        conversationId,
        clientId: client?.id ?? null,
        ...(leadWrite ? { leadId } : {}),
      };
    }),
  );

  // Fila depois da transacao: rede dentro dela seria refeita a cada repeticao.
  // Falha aqui nao desfaz o que foi gravado — a tarefa fica planejada, vence
  // no prazo e vira alerta para a equipe.
  const { replyTask, ...outcome } = result;
  if (replyTask) {
    try {
      await scheduleTask(replyTask, { clock, ...(enqueue ? { enqueue } : {}) });
    } catch (error) {
      logger.error("automation.inbound.reply_not_queued", {
        taskId: replyTask.id,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  return outcome;
}

/**
 * O eco de coexistência prova que alguém respondeu pelo app WhatsApp Business.
 * A identidade individual não vem no evento; por isso o registro diz apenas
 * "Profissional" e a conversa fica sob responsabilidade humana até liberação.
 *
 * Tomar a conversa é monotônico: eco repetido não grava de novo, e eco
 * atrasado assume a conversa sem trocar o resumo por uma mensagem mais velha.
 */
export async function applyHumanEcho(event, deps = {}) {
  const { clock = () => new Date().toISOString() } = deps;
  const now = clock();
  const sender = await organizationOfSender(event.providerSenderId);
  if (!sender) return { outcome: "UNKNOWN_SENDER" };
  const organizationId = sender.organizationId;
  const phone = normalizeInboundPhone(event.to);
  if (!phone) return { outcome: "INVALID_PHONE" };
  if (sender.mode === "TEST" && !sender.testRecipients?.includes(phone)) {
    return { outcome: "TEST_CONTACT_NOT_ALLOWED" };
  }

  const firestore = db();
  const scope = {
    doc: (collection, id) =>
      firestore.doc(paths.document(organizationId, collection, id)),
  };
  const messageId = inboundMessageId(event.providerMessageId);

  return firestore.runTransaction(async (transaction) => {
    const { client, ambiguous } = await clientOfPhone(
      transaction,
      organizationId,
      phone,
    );
    const leadId =
      !client && !ambiguous ? leadIdFor(organizationId, phone) : null;
    const lead = leadId
      ? stored("leads", await transaction.get(scope.doc("leads", leadId)))
      : null;
    const conversationId = conversationOfContact({
      client,
      leadId,
      lead,
      phone,
    });
    const conversation = conversationId
      ? stored(
          "conversations",
          await transaction.get(scope.doc("conversations", conversationId)),
        )
      : null;
    if (!conversation)
      return { outcome: "ECHO_WITHOUT_CONVERSATION", organizationId };
    const messageRef = firestore.doc(
      messagePath(organizationId, conversationId, messageId),
    );
    if ((await transaction.get(messageRef)).exists) {
      return { outcome: "DUPLICATE", organizationId, conversationId };
    }
    const pendingTask = conversation.pendingAssistantTaskId
      ? stored(
          "automationTasks",
          await transaction.get(
            scope.doc("automationTasks", conversation.pendingAssistantTaskId),
          ),
        )
      : null;
    const pendingDelivery = pendingTask?.deliveryId
      ? stored(
          "notificationDeliveries",
          await transaction.get(
            scope.doc("notificationDeliveries", pendingTask.deliveryId),
          ),
        )
      : null;
    const newer =
      Date.parse(event.sentAt) >= Date.parse(conversation.lastMessageAt);

    transaction.create(
      messageRef,
      toStored("messages", {
        id: messageId,
        organizationId,
        conversationId,
        clientId: conversation.clientId,
        professionalId: conversation.professionalId,
        providerMessageId: event.providerMessageId,
        direction: "OUTBOUND",
        authorType: "PROFESSIONAL",
        authorName: "Profissional pelo WhatsApp Business",
        channel: "WHATSAPP",
        body: event.text,
        sentAt: event.sentAt,
        readAt: event.sentAt,
        classification: null,
        classificationConfidence: null,
        aiDecisionId: null,
        createdAt: now,
        createdBy: null,
        updatedAt: now,
        updatedBy: null,
      }),
    );
    transaction.set(
      scope.doc("conversations", conversationId),
      toStored("conversations", {
        // Eco atrasado não vira o resumo nem tira a conversa de quem escreveu
        // depois; a tomada humana, essa sim, vale sempre.
        ...(newer
          ? {
              status: "WAITING_CLIENT",
              lastMessagePreview: preview(event.text),
              lastMessageAt: event.sentAt,
              unreadCount: 0,
            }
          : {}),
        escalated: true,
        escalationReason:
          "Conversa assumida pelo profissional no WhatsApp Business.",
        humanTakeoverAt: conversation.humanTakeoverAt ?? now,
        humanTakeoverSource:
          conversation.humanTakeoverSource ?? "WHATSAPP_BUSINESS",
        pendingAssistantTaskId: null,
        updatedAt: now,
        updatedBy: null,
      }),
      { merge: true },
    );
    cancelPendingAutomation({
      transaction,
      scope,
      tasks: pendingTask ? [pendingTask] : [],
      deliveries: pendingDelivery ? [pendingDelivery] : [],
      now,
      code: "CONVERSATION_WITH_HUMAN",
    });
    if (lead && lead.status !== "TAKEN_OVER") {
      transaction.set(
        scope.doc("leads", lead.id),
        toStored("leads", {
          ...lead,
          status: "TAKEN_OVER",
          statusChangedAt: now,
          updatedAt: now,
          updatedBy: null,
        }),
      );
    }
    transaction.create(
      scope.doc("auditLogs", `${messageId}-handoff`),
      toStored("auditLogs", {
        id: `${messageId}-handoff`,
        organizationId,
        actorType: "SYSTEM",
        actorId: null,
        actorName: "WhatsApp Business",
        action: "UPDATE",
        resource: { type: "conversation", id: conversationId },
        summary:
          "Resposta humana detectada no app WhatsApp Business; automação pausada.",
        metadata: { channel: "WHATSAPP", messageId },
        occurredAt: now,
        createdAt: now,
        createdBy: null,
        updatedAt: now,
        updatedBy: null,
      }),
    );
    return {
      outcome: "HUMAN_ECHO",
      organizationId,
      conversationId,
      ...(lead ? { leadId: lead.id } : {}),
    };
  });
}

/** Grava a resposta da assistente, se ela puder sair, na transacao de quem pediu. */
function planReply(ctx) {
  const {
    transaction,
    scope,
    organizationId,
    organizationSnapshot,
    client,
    sender,
    conversation,
    sentAt,
  } = ctx;
  const raw = stored("organizations", organizationSnapshot);
  if (!raw || raw.deletion || !isProfessionId(raw.primaryProfession)) {
    return { kind: "SKIPPED", reason: "ORGANIZATION_DISABLED" };
  }
  const plan = planConversationReply({
    organization: withOrganizationDefaults(
      raw,
      organizationId,
      raw.primaryProfession,
      ctx.now,
    ),
    profession: getProfession(raw.primaryProfession),
    client,
    sender,
    event: ctx.event,
    stage: ctx.stage,
    channel: "WHATSAPP",
    conversation: {
      escalated: conversation?.escalated ?? false,
      attention: conversation?.attention ?? "NORMAL",
      // A janela que ESTA mensagem abriu.
      inboundWindowEndsAt: inboundWindowEndsAt(sentAt),
    },
    now: ctx.now,
    validUntil: ctx.validUntil ?? null,
    details: ctx.details,
    responseText: ctx.responseText ?? null,
    inboundMessageId: ctx.messageId,
    appointment: ctx.appointment,
    professionalId: ctx.professionalId ?? null,
    scheduledFor: ctx.scheduledFor ?? ctx.now,
    sourceDecisionId: ctx.sourceDecisionId ?? null,
    leadId: ctx.leadId ?? null,
  });
  if (plan.kind === "PLANNED") {
    transaction.create(
      scope.doc("automationTasks", plan.task.id),
      toStored("automationTasks", plan.task),
    );
    transaction.set(
      scope.doc("notificationDeliveries", plan.delivery.id),
      toStored("notificationDeliveries", plan.delivery),
    );
  }
  return plan;
}

/** O que o resultado conta da resposta: planejada, ou por que nao. */
function replyOutcome(plan) {
  if (!plan) return {};
  return plan.kind === "PLANNED"
    ? { reply: "PLANNED", replyTask: plan.task }
    : { reply: plan.reason };
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
    if (
      !verifyBridgeSignature(
        bridgeSecret,
        timestamp,
        body,
        request.get(BRIDGE_SIGNATURE_HEADER),
      )
    ) {
      logger.warn("automation.inbound.refused", {
        outcome: "BAD_BRIDGE_SIGNATURE",
      });
      response.status(401).send("Assinatura inválida.");
      return;
    }
    // 2. A Meta, sobre o corpo bruto. Sem ela, um n8n comprometido inventaria
    //    mensagem de paciente.
    if (
      !verifyMetaSignature(appSecret, raw, request.get("x-hub-signature-256"))
    ) {
      logger.warn("automation.inbound.refused", {
        outcome: "BAD_META_SIGNATURE",
      });
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
      // Por que a resposta da assistente saiu ou nao: motivo nomeado, sem texto.
      const replies = [];
      for (const event of events) {
        const result =
          event.kind === "HUMAN_ECHO"
            ? await applyHumanEcho(event)
            : await applyInboundEvent(event);
        outcomes.push(result.outcome);
        if (result.reply) replies.push(result.reply);
      }
      logger.info("automation.inbound", {
        received: events.length,
        outcomes,
        replies,
      });
      // 200 sempre que o corpo foi aceito: a Meta reentrega o que nao recebe
      // 200, e reentrega e inofensiva pela trava de duplicidade.
      response.status(200).json({ received: events.length });
    } catch (error) {
      logger.error("automation.inbound.failed", {
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode:
          error &&
          (typeof error.code === "string" || typeof error.code === "number")
            ? String(error.code)
            : "UNKNOWN",
      });
      response.status(500).send("Falha ao processar a mensagem.");
    }
  },
);

/** Oferece um novo horario sem inventar servico, preco ou profissional. */
async function handleBookingRequest(ctx) {
  const {
    transaction,
    scope,
    firestore,
    organizationId,
    organizationSnapshot,
    conversationId,
    client,
    professionalId,
    messageId,
    now,
    replyTo,
  } = ctx;
  const raw = stored("organizations", organizationSnapshot);
  const organization =
    raw && isProfessionId(raw.primaryProfession)
      ? withOrganizationDefaults(
          raw,
          organizationId,
          raw.primaryProfession,
          now,
        )
      : null;
  const profession = organization
    ? getProfession(organization.primaryProfession)
    : null;
  const policy = agendaSelfServicePolicyOf(
    organization?.settings.agenda.selfService,
  );

  const handoff = (reason) => {
    alertTeamAboutRoutine({
      transaction,
      scope,
      organizationId,
      conversationId,
      professionalId,
      messageId,
      now,
      kind: "agendamento",
      reason,
    });
    return {
      outcome: "SCHEDULE_ESCALATED",
      reason,
      reply: replyTo({
        event: "SCHEDULE_HANDED_OFF",
        stage: "REQUEST",
        appointment: null,
        professionalId,
      }),
    };
  };

  if (!policy.bookingEnabled) return handoff("POLICY_DISABLED");
  if (!organization || !profession || !client || !professionalId) {
    return handoff("CONTEXT_NOT_UNIQUE");
  }
  const durationMinutes = profession.defaultAppointmentDurationMinutes;
  const priceInCents = profession.defaultPriceInCents;
  if (durationMinutes === null || priceInCents === null) {
    return handoff("SERVICE_REQUIRED");
  }
  const professional = stored(
    "professionals",
    await transaction.get(scope.doc("professionals", professionalId)),
  );
  if (!professional) return handoff("PROFESSIONAL_NOT_FOUND");

  const busy = await busyOfAgenda({
    transaction,
    firestore,
    scope,
    organizationId,
    professionalId,
    now,
  });
  const slots = firstAvailableSlots(
    {
      agenda: organization.settings.agenda,
      durationMinutes,
      bufferMinutes: 0,
      from: now,
      to: new Date(
        Date.parse(now) + policy.searchWindowDays * 86_400_000,
      ).toISOString(),
      busy,
      timezoneOffsetMinutes: offsetOfTimezone(organization.timezone),
    },
    policy.offeredSlots,
  );
  if (slots.length === 0) return handoff("NO_SLOTS");

  const holdEndsAt = rescheduleHoldEndsAt(now);
  transaction.set(
    scope.doc("bookingRequests", conversationId),
    toStored("bookingRequests", {
      id: conversationId,
      organizationId,
      clientId: client.id,
      professionalId,
      professionalName: professional.displayName,
      appointmentId: null,
      status: "OFFERED",
      slots,
      holdEndsAt,
      offeredAt: now,
      durationMinutes,
      priceInCents,
      modality:
        client.preferredModality ??
        organization.settings.agenda.defaultModality,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    }),
  );
  const reply = replyTo({
    event: "SCHEDULE_OFFERED",
    stage: "REQUEST",
    appointment: null,
    professionalId,
    validUntil: holdEndsAt,
    details: { slots },
  });
  return { outcome: "SCHEDULE_OFFERED", reply };
}

/** Confirma a vaga dentro da mesma transacao que relê toda a agenda. */
async function confirmBookingSlot(ctx) {
  const {
    transaction,
    scope,
    firestore,
    organizationId,
    conversationId,
    pending,
    chosen,
    client,
    organizationSnapshot,
    messageId,
    now,
    replyTo,
  } = ctx;
  const raw = stored("organizations", organizationSnapshot);
  const organization =
    raw && isProfessionId(raw.primaryProfession)
      ? withOrganizationDefaults(
          raw,
          organizationId,
          raw.primaryProfession,
          now,
        )
      : null;
  const policy = agendaSelfServicePolicyOf(
    organization?.settings.agenda.selfService,
  );
  const handoff = (reason, status = "ESCALATED") => {
    transaction.set(
      scope.doc("bookingRequests", pending.id),
      toStored("bookingRequests", {
        ...pending,
        status,
        updatedAt: now,
        updatedBy: null,
      }),
    );
    alertTeamAboutRoutine({
      transaction,
      scope,
      organizationId,
      conversationId,
      professionalId: pending.professionalId,
      messageId,
      now,
      kind: "agendamento",
      reason,
    });
    return {
      outcome: status === "EXPIRED" ? "SCHEDULE_RETRY" : "SCHEDULE_ESCALATED",
      reason,
      reply: replyTo({
        event: "SCHEDULE_HANDED_OFF",
        stage: "CHOICE",
        appointment: null,
        professionalId: pending.professionalId,
      }),
    };
  };

  if (!policy.bookingEnabled) return handoff("POLICY_DISABLED");
  if (!client || client.id !== pending.clientId)
    return handoff("CLIENT_CHANGED");
  if (Date.parse(now) > Date.parse(pending.holdEndsAt)) {
    return handoff("HOLD_EXPIRED", "EXPIRED");
  }
  const professional = stored(
    "professionals",
    await transaction.get(scope.doc("professionals", pending.professionalId)),
  );
  if (!professional) return handoff("PROFESSIONAL_NOT_FOUND");
  const busy = await busyOfAgenda({
    transaction,
    firestore,
    scope,
    organizationId,
    professionalId: pending.professionalId,
    now,
  });
  if (!isSlotFree(chosen, busy, 0)) return handoff("SLOT_TAKEN", "EXPIRED");

  const appointmentId = `${messageId}-appointment`;
  const appointment = {
    id: appointmentId,
    organizationId,
    clientId: client.id,
    clientName: client.fullName,
    professionalId: pending.professionalId,
    professionalName: professional.displayName,
    startsAt: chosen.startsAt,
    endsAt: chosen.endsAt,
    durationMinutes: pending.durationMinutes,
    serviceId: null,
    serviceName: null,
    modality: pending.modality,
    status: "SCHEDULED",
    priceInCents: pending.priceInCents,
    depositInCents: null,
    depositOutcome: null,
    visitAddress: null,
    travelFeeInCents: null,
    administrativeNotes: null,
    origin: "CLIENT_SELF_SERVICE",
    confirmedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    rescheduledFromId: null,
    externalCalendar: null,
    createdAt: now,
    createdBy: null,
    updatedAt: now,
    updatedBy: null,
  };
  transaction.create(
    scope.doc("appointments", appointmentId),
    toStored("appointments", appointment),
  );
  transaction.create(
    scope.doc("transactions", `${messageId}-income`),
    toStored("transactions", {
      id: `${messageId}-income`,
      organizationId,
      type: "INCOME",
      clientId: client.id,
      clientName: client.fullName,
      professionalId: pending.professionalId,
      appointmentId,
      appointmentPart: "SERVICE",
      description: `Atendimento de ${client.fullName}`,
      amountInCents: pending.priceInCents,
      status: "PENDING",
      method: null,
      dueDate: chosen.startsAt,
      paidAt: null,
      gateway: null,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    }),
  );
  transaction.set(
    scope.doc("bookingRequests", pending.id),
    toStored("bookingRequests", {
      ...pending,
      appointmentId,
      status: "CONFIRMED",
      updatedAt: now,
      updatedBy: null,
    }),
  );
  transaction.create(
    scope.doc("auditLogs", `${messageId}-agendado`),
    toStored("auditLogs", {
      id: `${messageId}-agendado`,
      organizationId,
      actorType: "SYSTEM",
      actorId: null,
      actorName: "Automação do Atendara",
      action: "CREATE",
      resource: { type: "appointment", id: appointmentId },
      summary:
        "Agendado pela própria pessoa, pelo WhatsApp, dentro da política da organização.",
      metadata: { startsAt: chosen.startsAt, channel: "WHATSAPP" },
      occurredAt: now,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    }),
  );
  const reply = replyTo({
    event: "SCHEDULE_CONFIRMED",
    stage: "CHOICE",
    appointment,
    details: { startsAt: appointment.startsAt },
  });
  return { outcome: "SCHEDULE_CONFIRMED", reply };
}

/** Cancela somente o caso inequivoco e sem decisao financeira pendente. */
async function handleCancellationRequest(ctx) {
  const {
    transaction,
    scope,
    firestore,
    organizationId,
    organizationSnapshot,
    conversationId,
    client,
    messageId,
    now,
    replyTo,
  } = ctx;
  const raw = stored("organizations", organizationSnapshot);
  const organization =
    raw && isProfessionId(raw.primaryProfession)
      ? withOrganizationDefaults(
          raw,
          organizationId,
          raw.primaryProfession,
          now,
        )
      : null;
  const policy = agendaSelfServicePolicyOf(
    organization?.settings.agenda.selfService,
  );
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
      ).docs
        .map((document) => stored("appointments", document))
        .filter(
          (item) => item.status === "SCHEDULED" || item.status === "CONFIRMED",
        )
    : [];
  const appointment = futuros.length === 1 ? futuros[0] : null;
  const handoff = (reason) => {
    alertTeamAboutRoutine({
      transaction,
      scope,
      organizationId,
      conversationId,
      professionalId: appointment?.professionalId ?? null,
      messageId,
      now,
      kind: "cancelamento",
      reason,
    });
    return {
      outcome: "CANCELLATION_ESCALATED",
      reason,
      reply: replyTo({
        event: "CANCELLATION_HANDED_OFF",
        stage: "REQUEST",
        appointment,
        professionalId: appointment?.professionalId ?? null,
      }),
    };
  };

  if (!policy.cancellationEnabled) return handoff("POLICY_DISABLED");
  if (futuros.length === 0) return handoff("APPOINTMENT_NOT_FOUND");
  if (futuros.length > 1) return handoff("MULTIPLE_APPOINTMENTS");
  const noticeMs = Date.parse(appointment.startsAt) - Date.parse(now);
  if (noticeMs < policy.minimumCancellationNoticeHours * 3_600_000) {
    return handoff("TOO_LATE");
  }
  const transactions = (
    await transaction.get(
      firestore
        .collection(paths.collection(organizationId, "transactions"))
        .where("appointmentId", "==", appointment.id)
        .limit(20),
    )
  ).docs.map((document) => stored("transactions", document));
  if (
    appointment.depositInCents != null ||
    transactions.some((item) => item.status === "PAID")
  ) {
    return handoff("FINANCIAL_REVIEW_REQUIRED");
  }

  const cancelled = {
    ...appointment,
    status: "CANCELLED",
    cancelledAt: now,
    cancellationReason: "Cancelado pela própria pessoa, pelo WhatsApp.",
    origin: "CLIENT_SELF_SERVICE",
    updatedAt: now,
    updatedBy: null,
  };
  transaction.set(
    scope.doc("appointments", appointment.id),
    toStored("appointments", cancelled),
  );
  for (const item of transactions) {
    if (item.status === "CANCELLED" || item.status === "REFUNDED") continue;
    transaction.set(
      scope.doc("transactions", item.id),
      toStored("transactions", {
        ...item,
        status: "CANCELLED",
        updatedAt: now,
        updatedBy: null,
      }),
    );
  }
  transaction.create(
    scope.doc("auditLogs", `${messageId}-cancelado`),
    toStored("auditLogs", {
      id: `${messageId}-cancelado`,
      organizationId,
      actorType: "SYSTEM",
      actorId: null,
      actorName: "Automação do Atendara",
      action: "UPDATE",
      resource: { type: "appointment", id: appointment.id },
      summary:
        "Cancelado pela própria pessoa, pelo WhatsApp, dentro da política da organização.",
      metadata: { startsAt: appointment.startsAt, channel: "WHATSAPP" },
      occurredAt: now,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    }),
  );
  const reply = replyTo({
    event: "CANCELLATION_CONFIRMED",
    stage: "REQUEST",
    appointment: cancelled,
    details: { startsAt: cancelled.startsAt },
  });
  return { outcome: "CANCELLATION_CONFIRMED", reply };
}

function alertTeamAboutRoutine(ctx) {
  const {
    transaction,
    scope,
    organizationId,
    conversationId,
    professionalId,
    messageId,
    now,
    kind,
    reason,
  } = ctx;
  const id = `${messageId}-${kind}`;
  transaction.create(
    scope.doc("notifications", id),
    toStored("notifications", {
      id,
      organizationId,
      type: "CLIENT_WAITING",
      status: "UNREAD",
      priority: "HIGH",
      title: `Pedido de ${kind} precisa da equipe`,
      body: `A Dara encaminhou o pedido. Motivo: ${reason}.`,
      target: { type: "conversation", id: conversationId },
      professionalId,
      channels: ["DASHBOARD"],
      aiDecisionId: `${messageId}-decision`,
      acknowledgedAt: null,
      acknowledgedBy: null,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    }),
  );
}

/**
 * O pedido de remarcacao: le a politica, procura o atendimento futuro e os
 * horarios livres, e ou oferece (segurando a escolha) ou escala com o motivo.
 *
 * **Escalar nao e falhar.** Fora da politica, o pedido vira alerta para a
 * equipe — com o motivo escrito —, e a pessoa nao fica sem resposta.
 */
async function handleRescheduleRequest(ctx) {
  const {
    transaction,
    scope,
    firestore,
    organizationId,
    organizationSnapshot,
    conversationId,
    client,
    messageId,
    now,
    replyTo,
  } = ctx;

  const organization = stored("organizations", organizationSnapshot);
  // Agenda completada pelos padroes da profissao, como a tela a mostra. O
  // documento cru pode ter so parte dos campos — a politica gravada sem o
  // expediente, por exemplo — e calcular horario com campo ausente derrubava
  // o webhook, que a Meta reentregava para derrubar de novo.
  const agenda =
    organization && isProfessionId(organization.primaryProfession)
      ? withOrganizationDefaults(
          organization,
          organizationId,
          organization.primaryProfession,
          now,
        ).settings.agenda
      : null;
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
  const appointment =
    futuros.find(
      (item) => item.status === "SCHEDULED" || item.status === "CONFIRMED",
    ) ??
    futuros[0] ??
    null;

  const busy = await busyOfAgenda({
    transaction,
    firestore,
    scope,
    organizationId,
    professionalId: appointment?.professionalId ?? null,
    now,
  });

  const decided = decideReschedule({
    policy,
    appointment,
    previousReschedules: selfServiceReschedulesOf(appointment),
    availability: {
      agenda: agenda ?? {
        workingDays: [1, 2, 3, 4, 5],
        workdayStart: "08:00",
        workdayEnd: "18:00",
        slotIntervalMinutes: 30,
      },
      bufferMinutes: 0,
      from: now,
      to: new Date(
        Date.parse(now) + policy.searchWindowDays * 86_400_000,
      ).toISOString(),
      busy,
      // Fuso da organizacao: o expediente e lido nele, e a resposta sai em UTC.
      timezoneOffsetMinutes: offsetOfTimezone(organization?.timezone),
    },
    now,
  });

  if (decided.kind === "ESCALATE") {
    alertTeamAboutReschedule({
      transaction,
      scope,
      organizationId,
      conversationId,
      professionalId: appointment?.professionalId ?? null,
      reason: decided.reason,
      messageId,
      now,
    });
    // A pessoa ouve que o pedido foi para a equipe; o motivo fica no alerta.
    const reply = replyTo({
      event: "RESCHEDULE_HANDED_OFF",
      stage: "REQUEST",
      appointment,
    });
    return { outcome: "RESCHEDULE_ESCALATED", reason: decided.reason, reply };
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
  // A oferta vale enquanto a reserva vale: depois dela, os horarios ja nao
  // estao segurados e nao podem ser mostrados como livres.
  const reply = replyTo({
    event: "RESCHEDULE_OFFERED",
    stage: "REQUEST",
    appointment: decided.appointment,
    validUntil: decided.holdEndsAt,
    details: { slots: decided.slots },
  });
  return { outcome: "RESCHEDULE_OFFERED", reply };
}

/** A escolha da pessoa, conferida contra a agenda do mesmo instante. */
async function confirmChosenSlot(ctx) {
  const {
    transaction,
    scope,
    firestore,
    organizationId,
    conversationId,
    pending,
    chosen,
    appointment,
    messageId,
    now,
    replyTo,
  } = ctx;

  const encaminhar = (reason, status, outcome) => {
    transaction.set(
      scope.doc("rescheduleRequests", pending.id),
      toStored("rescheduleRequests", {
        ...pending,
        status,
        updatedAt: now,
        updatedBy: null,
      }),
    );
    // A pessoa escolheu e nao recebeu o horario: sem alerta, o pedido sumiria.
    alertTeamAboutReschedule({
      transaction,
      scope,
      organizationId,
      conversationId,
      professionalId: appointment?.professionalId ?? null,
      reason,
      messageId,
      now,
    });
    const reply = replyTo({
      event: "RESCHEDULE_HANDED_OFF",
      stage: "CHOICE",
      appointment,
    });
    return { outcome, reason, reply };
  };

  if (!appointment)
    return encaminhar(
      "APPOINTMENT_NOT_FOUND",
      "ESCALATED",
      "RESCHEDULE_ESCALATED",
    );

  // Lida de novo AQUI, e nao a copia guardada na oferta: entre oferecer e
  // escolher a equipe marca, e so a leitura desta transacao ve isso.
  const busy = await busyOfAgenda({
    transaction,
    firestore,
    scope,
    organizationId,
    professionalId: appointment.professionalId,
    now,
  });

  const confirmacao = confirmReschedule({
    appointment,
    chosen,
    busy,
    bufferMinutes: 0,
    holdEndsAt: pending.holdEndsAt,
    offeredAt: pending.offeredAt,
    now,
  });

  if (confirmacao.kind === "ESCALATE")
    return encaminhar(confirmacao.reason, "ESCALATED", "RESCHEDULE_ESCALATED");
  if (confirmacao.kind === "RETRY")
    return encaminhar(confirmacao.reason, "EXPIRED", "RESCHEDULE_RETRY");

  transaction.set(
    scope.doc("appointments", appointment.id),
    toStored("appointments", confirmacao.appointment),
  );
  transaction.set(
    scope.doc("rescheduleRequests", pending.id),
    toStored("rescheduleRequests", {
      ...pending,
      status: "CONFIRMED",
      updatedAt: now,
      updatedBy: null,
    }),
  );
  transaction.create(
    scope.doc("auditLogs", `${messageId}-remarcado`),
    toStored("auditLogs", {
      id: `${messageId}-remarcado`,
      organizationId: appointment.organizationId,
      actorType: "SYSTEM",
      actorId: null,
      actorName: "Automação do Atendara",
      action: "UPDATE",
      resource: { type: "appointment", id: appointment.id },
      summary:
        "Remarcado pela própria pessoa, pelo WhatsApp, dentro da política da organização.",
      metadata: {
        from: appointment.startsAt,
        to: confirmacao.appointment.startsAt,
        channel: "WHATSAPP",
      },
      occurredAt: now,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    }),
  );
  const reply = replyTo({
    event: "RESCHEDULE_CONFIRMED",
    stage: "CHOICE",
    appointment: confirmacao.appointment,
    details: { startsAt: confirmacao.appointment.startsAt },
  });
  return { outcome: "RESCHEDULE_CONFIRMED", reply };
}

/**
 * O que ocupa a agenda agora: atendimentos ativos e o ocupado da agenda
 * pessoal do profissional. Serve a oferta e a confirmacao, que precisam da
 * mesma resposta lida em momentos diferentes.
 */
async function busyOfAgenda(ctx) {
  const { transaction, firestore, scope, organizationId, professionalId, now } =
    ctx;
  const agendaExterna = professionalId
    ? stored(
        "calendarBusyBlocks",
        await transaction.get(scope.doc("calendarBusyBlocks", professionalId)),
      )
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
  return busy;
}

function alertTeamAboutReschedule(ctx) {
  const {
    transaction,
    scope,
    organizationId,
    conversationId,
    professionalId,
    reason,
    messageId,
    now,
  } = ctx;
  const alertId = `${messageId}-remarcacao`;
  transaction.create(
    scope.doc("notifications", alertId),
    toStored("notifications", {
      id: alertId,
      organizationId,
      type: "CLIENT_WAITING",
      status: "UNREAD",
      priority: "HIGH",
      title: "Pedido de remarcação para a equipe",
      body: RESCHEDULE_REFUSAL_LABELS[reason],
      target: { type: "conversation", id: conversationId },
      professionalId,
      channels: ["DASHBOARD"],
      aiDecisionId: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    }),
  );
}

/**
 * Fuso da organizacao em minutos. Sem biblioteca de fuso no backend: o que
 * existe hoje e o horario de Brasilia, e qualquer outro cai no mesmo valor ate
 * a 13.7, que traz a agenda externa e com ela a conversao completa.
 */
function offsetOfTimezone(timezone) {
  return timezone === "UTC" ? 0 : -180;
}
