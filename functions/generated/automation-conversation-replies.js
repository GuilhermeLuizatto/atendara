// Gerado por scripts/build-functions.mjs.
import { CONVERSATION_REPLY_VALIDITY_MINUTES } from "./automation-config.js";
import { CHANNEL_META, RETRY_POLICY } from "./notifications-config.js";
import { evaluateConversationReply } from "./notifications-eligibility.js";
import { addMinutes } from "./notifications-schedule.js";
import { hashBody } from "./notifications-templates.js";
/** Uma resposta por mensagem recebida: a reentrega da Meta cai no mesmo id. */
export function conversationReplyId(inboundMessageId) {
    return `${inboundMessageId}-resposta`;
}
export function planConversationReply(input) {
    if (!input.client) {
        return { kind: "SKIPPED", reason: "CLIENT_NOT_IDENTIFIED" };
    }
    if (input.event !== "ADMINISTRATIVE_REPLY" && !input.appointment) {
        return { kind: "SKIPPED", reason: "NO_APPOINTMENT" };
    }
    const decision = evaluateConversationReply(input);
    if (!decision.eligible)
        return { kind: "SKIPPED", reason: decision.reason };
    const rule = input.organization.settings.notifications.rules.find((item) => item.event === input.event && item.channel === input.channel);
    // O portão já exigiu a regra; chegar aqui sem ela seria erro de quem chamou.
    if (!rule)
        return { kind: "SKIPPED", reason: "NO_RULE_FOR_EVENT" };
    const id = conversationReplyId(input.inboundMessageId);
    const at = input.now;
    const scheduledFor = input.scheduledFor ?? at;
    const expiresAt = replyExpiresAt(input, scheduledFor);
    const { appointment, client } = input;
    const professionalId = appointment?.professionalId ?? input.professionalId ?? null;
    const delivery = {
        id,
        organizationId: input.organization.id,
        createdAt: at,
        updatedAt: at,
        createdBy: null,
        updatedBy: null,
        audience: "ORGANIZATION_TO_CLIENT",
        event: input.event,
        channel: input.channel,
        ruleId: rule.id,
        appointmentId: appointment?.id ?? null,
        clientId: client.id,
        professionalId,
        scheduledFor,
        status: "PLANNED",
        attempts: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        providerId: CHANNEL_META[input.channel].providerId,
        providerMessageId: null,
        failureCode: null,
        templateId: `assistant:${input.event}:${input.stage}`,
        bodyHash: hashBody(decision.body),
        bodyLength: decision.body.length,
        contactHint: decision.contactHint,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        cancelledAt: null,
    };
    const task = {
        id,
        organizationId: input.organization.id,
        createdAt: at,
        updatedAt: at,
        createdBy: null,
        updatedBy: null,
        type: "SEND_CONVERSATION_REPLY",
        status: "PLANNED",
        attempt: 1,
        maxAttempts: RETRY_POLICY.maxAttempts,
        scheduledFor,
        expiresAt,
        idempotencyKey: id,
        appointmentId: appointment?.id ?? null,
        appointmentStartsAt: appointment?.startsAt ?? null,
        clientId: client.id,
        professionalId,
        deliveryId: id,
        sourceTaskId: null,
        sourceMessageId: input.inboundMessageId,
        sourceDecisionId: input.sourceDecisionId ?? null,
        event: input.event,
        channel: input.channel,
        failureCode: null,
        stopReason: null,
        providerMessageId: null,
        dispatchingSince: null,
        completedAt: null,
        history: [{ from: null, to: "PLANNED", at, attempt: 1, code: null }],
        replyStage: input.stage,
    };
    return { kind: "PLANNED", task, delivery };
}
/**
 * A resposta vale pelo menor dos prazos: o dela (reserva da oferta, ou a
 * validade curta das demais) e a janela de 24 horas que a pessoa abriu.
 */
function replyExpiresAt(input, scheduledFor) {
    const own = input.validUntil ??
        addMinutes(scheduledFor, CONVERSATION_REPLY_VALIDITY_MINUTES);
    const window = input.conversation.inboundWindowEndsAt;
    const limits = [Date.parse(own), ...(window ? [Date.parse(window)] : [])];
    return new Date(Math.min(...limits)).toISOString();
}
