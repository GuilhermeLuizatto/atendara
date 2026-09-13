// Gerado por scripts/build-functions.mjs.
import { CHANNEL_META } from "./notifications-config.js";
import { contactFor } from "./notifications-contacts.js";
import { deliveryKey } from "./notifications-delivery.js";
import { evaluateRule } from "./notifications-eligibility.js";
import { hashBody } from "./notifications-templates.js";
export function planAppointmentNotifications(input) {
    const settings = input.organization.settings.notifications;
    const planned = [];
    const skipped = [];
    const rules = settings.rules.filter((rule) => rule.event === input.event);
    if (rules.length === 0) {
        return {
            planned,
            skipped: [
                {
                    ruleId: null,
                    channel: null,
                    reason: settings.enabled
                        ? "NO_RULE_FOR_EVENT"
                        : "ORGANIZATION_DISABLED",
                },
            ],
        };
    }
    // Os ids ja planejados nesta mesma passagem entram na conferencia: duas
    // regras iguais para o mesmo par evento+canal produziriam duas mensagens
    // identicas para a mesma pessoa.
    const seen = new Set(input.existingDeliveryIds);
    for (const rule of rules) {
        const decision = evaluateRule(rule, {
            ...input,
            existingDeliveryIds: [...seen],
        });
        if (!decision.eligible) {
            skipped.push({ ruleId: rule.id, channel: rule.channel, reason: decision.reason });
            continue;
        }
        const contact = contactFor(input.client, rule.channel);
        if (!contact) {
            skipped.push({ ruleId: rule.id, channel: rule.channel, reason: "INVALID_CONTACT" });
            continue;
        }
        const id = deliveryKey({
            appointmentId: input.appointment.id,
            event: input.event,
            channel: rule.channel,
            scheduledFor: decision.scheduledFor,
        });
        seen.add(id);
        planned.push({
            id,
            ruleId: rule.id,
            event: input.event,
            channel: rule.channel,
            appointmentId: input.appointment.id,
            clientId: input.client.id,
            professionalId: input.appointment.professionalId,
            scheduledFor: decision.scheduledFor,
            body: decision.body,
            bodyHash: hashBody(decision.body),
            bodyLength: decision.body.length,
            destination: contact.destination,
            contactHint: contact.hint,
            templateId: rule.customTemplate ? `custom:${rule.id}` : `profession:${input.profession.id}:${input.event}`,
            providerId: CHANNEL_META[rule.channel].providerId,
        });
    }
    return { planned, skipped };
}
/**
 * Registro de entrega a partir do plano.
 *
 * O que NAO e copiado do plano e o ponto: `body` e `destination` ficam de fora.
 * O registro guarda hash, tamanho e as ultimas posicoes do contato — suficiente
 * para auditar o envio, insuficiente para reconstruir a mensagem ou a agenda de
 * contatos de quem e atendido.
 */
export function toDeliveryDocument(plan, organizationId, now, actorId) {
    return {
        id: plan.id,
        organizationId,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        audience: "ORGANIZATION_TO_CLIENT",
        event: plan.event,
        channel: plan.channel,
        ruleId: plan.ruleId,
        appointmentId: plan.appointmentId,
        clientId: plan.clientId,
        professionalId: plan.professionalId,
        scheduledFor: plan.scheduledFor,
        status: "PLANNED",
        attempts: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        providerId: plan.providerId,
        providerMessageId: null,
        failureCode: null,
        templateId: plan.templateId,
        bodyHash: plan.bodyHash,
        bodyLength: plan.bodyLength,
        contactHint: plan.contactHint,
        sentAt: null,
        cancelledAt: null,
    };
}
