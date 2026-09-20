// Gerado por scripts/build-functions.mjs.
export const AUTOMATION_SWITCH_ON = {
    enabled: true,
    reason: null,
    changedAt: null,
    changedBy: null,
};
/**
 * A saída pode acontecer agora?
 *
 * Ausente é ligada: uma organização que nunca tocou na chave não fica muda por
 * omissão. O que desliga é sempre um ato registrado.
 */
export function outboundBlock(input) {
    if (input.global && input.global.enabled === false)
        return "GLOBAL_SWITCH_OFF";
    if (input.organization && input.organization.enabled === false)
        return "ORGANIZATION_SWITCH_OFF";
    return null;
}
export const OUTBOUND_BLOCK_LABELS = {
    GLOBAL_SWITCH_OFF: "A saída de mensagens está suspensa para toda a plataforma.",
    ORGANIZATION_SWITCH_OFF: "A saída de mensagens está suspensa nesta organização.",
};
/**
 * Quanto tempo a tarefa parada espera antes de tentar de novo.
 *
 * Curto o bastante para a fila voltar sozinha logo depois de religar, e longo
 * o bastante para não transformar uma chave desligada por um dia inteiro em
 * milhares de tentativas.
 */
export const SWITCH_RETRY_MINUTES = 15;
export function switchRetryAt(now) {
    return new Date(Date.parse(now) + SWITCH_RETRY_MINUTES * 60_000).toISOString();
}
