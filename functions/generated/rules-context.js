// Gerado por scripts/build-functions.mjs.
export function buildEvaluationContext(source) {
    return {
        "message.classification": source.classification,
        "message.intent": source.intent,
        "message.channel": source.channel,
        "client.modality": source.clientModality,
        "client.status": source.clientStatus,
        "client.hasOutstandingBalance": source.clientHasOutstandingBalance,
        "appointment.status": source.appointmentStatus,
        "context.dayOfWeek": source.dayOfWeek,
        "context.hour": source.hour,
        "context.withinBusinessHours": source.withinBusinessHours,
        "agent.confidence": source.confidence,
    };
}
