// Gerado por scripts/build-functions.mjs.
const ALERT_PREFIX = "calendar-reconnect";
/**
 * Uma queda abre um único alerta por geração da conexão. A rotina de 30 minutos,
 * a consulta manual e a escrita de eventos podem perceber a mesma revogação;
 * compartilhar a chave impede três avisos para o mesmo problema.
 */
export function calendarReconnectAlertId(professionalId, generation) {
    return `${ALERT_PREFIX}-${professionalId}-${generation}`;
}
export function calendarReconnectAlert(input) {
    return {
        id: calendarReconnectAlertId(input.professionalId, input.generation),
        organizationId: input.organizationId,
        type: "AUTOMATION_FAILURE",
        priority: "HIGH",
        status: "UNREAD",
        title: "Google Calendar desconectado",
        body: "A autorização da agenda Google expirou ou foi revogada. Os horários ocupados e os eventos do Atendara não serão atualizados até a reconexão.",
        professionalId: input.professionalId,
        target: { type: "calendar_connection", id: input.professionalId },
        channels: ["DASHBOARD"],
        aiDecisionId: null,
        acknowledgedBy: null,
        acknowledgedAt: null,
        createdAt: input.at,
        createdBy: null,
        updatedAt: input.at,
        updatedBy: null,
    };
}
/** A conexão voltou (ou foi removida): o alerta técnico não continua aberto. */
export function resolveCalendarReconnectAlert(alert, actorId, at) {
    return {
        ...alert,
        status: "RESOLVED",
        acknowledgedBy: actorId,
        acknowledgedAt: at,
        updatedAt: at,
        updatedBy: actorId,
    };
}
