// Gerado por scripts/build-functions.mjs.
import { AUTOMATION_ACCEPTED_CONTRACT_VERSIONS, AUTOMATION_CONTRACT_VERSION } from "./automation-config.js";
import { DELIVERY_FAILURE_CODES } from "./types.js";
import { isTaskExpired, isTerminalStatus } from "./automation-tasks.js";
/**
 * O contrato entre o Atendara e o n8n (Fase 3, 13.3), sem I/O.
 *
 * Duas metades, as duas assinadas com HMAC-SHA256 e segredos DIFERENTES:
 *
 * - **ida** (`bridgeTaskPayload`): a tarefa que o n8n vai executar, com o
 *   minimo da secao 3 do plano. Segredo A.
 * - **volta** (`decideCallback`): o resultado que o n8n relata. Segredo B.
 *
 * Nada do que volta e aceito como verdade alem do resultado do envio: a
 * organizacao, a tentativa, o estado e o prazo sao conferidos contra a tarefa
 * lida do banco na mesma transacao. Um n8n comprometido consegue mentir sobre o
 * que o WhatsApp respondeu — e isso esta assumido na secao 10 do ADR 0003 —,
 * mas nao consegue mexer em tarefa de outra organizacao, ressuscitar tarefa
 * terminada, pular tentativa nem escrever na trilha.
 */
export const BRIDGE_CONTRACT_VERSION = AUTOMATION_CONTRACT_VERSION;
export const BRIDGE_TIMESTAMP_HEADER = "x-atendara-timestamp";
export const BRIDGE_SIGNATURE_HEADER = "x-atendara-signature";
/** Janela de validade da assinatura, nos dois sentidos (secao 3 do plano). */
export const BRIDGE_SIGNATURE_WINDOW_SECONDS = 300;
export const BRIDGE_MESSAGE_TYPES = ["TEMPLATE", "TEXT"];
export function bridgeTaskPayload(request) {
    // Modelo e texto livre ao mesmo tempo e erro de quem montou o pedido: qual dos
    // dois a Meta receberia dependeria de um detalhe do fluxo do n8n.
    if (request.freeText && request.template) {
        throw new Error("Envio com modelo e texto livre ao mesmo tempo.");
    }
    const messageType = request.template ? "TEMPLATE" : request.freeText ? "TEXT" : null;
    return {
        version: BRIDGE_CONTRACT_VERSION,
        taskId: request.taskId,
        organizationId: request.organizationId,
        attempt: request.attempt,
        idempotencyKey: request.idempotencyKey,
        expiresAt: request.expiresAt,
        channel: request.channel,
        ...(request.providerSenderId ? { providerSenderId: request.providerSenderId } : {}),
        deliveryId: request.deliveryId,
        destination: request.destination,
        body: request.body,
        ...(request.template
            ? {
                template: {
                    name: request.template.name,
                    language: request.template.language,
                    parameters: request.template.parameters,
                    buttons: request.template.buttons,
                },
            }
            : {}),
        ...(messageType ? { messageType } : {}),
    };
}
/**
 * A assinatura cobre horario **e** corpo. So o corpo deixaria um pedido antigo
 * valer para sempre; so o horario deixaria trocar o conteudo.
 */
export function signedMessage(timestamp, body) {
    return `${timestamp}.${body}`;
}
/** Fora da janela, a assinatura nao vale — mesmo correta. */
export function isWithinSignatureWindow(timestamp, now) {
    const sent = Date.parse(timestamp);
    if (Number.isNaN(sent))
        return false;
    return Math.abs(Date.parse(now) - sent) <= BRIDGE_SIGNATURE_WINDOW_SECONDS * 1000;
}
// ------------------------------------------------------------------ volta
/**
 * Progresso do canal real (13.4): o WhatsApp avisa que entregou e, quando a
 * pessoa permite, que ela leu. Nao e resultado — a tarefa ja terminou quando o
 * provedor aceitou —, entao progresso nunca muda estado de tarefa nem gasta
 * tentativa: so carimba a entrega.
 */
export const BRIDGE_PROGRESS_STATES = ["DELIVERED", "READ"];
const OUTCOMES = ["ACCEPTED", "TEMPORARY_FAILURE", "REJECTED"];
/**
 * Forma do retorno. Valida so o formato; quem confere se ele **pode** ser
 * aplicado e `decideCallback`, contra a tarefa do banco.
 */
export function parseCallbackPayload(data) {
    if (typeof data !== "object" || data === null)
        return null;
    const raw = data;
    const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
    const taskId = text(raw.taskId, 700);
    const organizationId = text(raw.organizationId, 128);
    const outcome = OUTCOMES.find((value) => value === raw.outcome) ?? null;
    const attempt = typeof raw.attempt === "number" && Number.isInteger(raw.attempt) && raw.attempt >= 1 && raw.attempt <= 10 ? raw.attempt : null;
    // Retorno de tarefa despachada antes da publicacao chega com a versao antiga.
    const version = typeof raw.version === "number" && AUTOMATION_ACCEPTED_CONTRACT_VERSIONS.includes(raw.version) ? raw.version : null;
    if (version === null || !taskId || !organizationId || !outcome || attempt === null)
        return null;
    const progress = BRIDGE_PROGRESS_STATES.find((value) => value === raw.progress) ?? null;
    if (raw.progress != null && progress === null)
        return null;
    // Progresso e sempre de envio aceito: "entregue" depois de "recusado" nao
    // existe, e aceitar isso deixaria o n8n reescrever a historia da entrega.
    if (progress && outcome !== "ACCEPTED")
        return null;
    const providerMessageId = raw.providerMessageId == null ? null : text(raw.providerMessageId, 200);
    if (raw.providerMessageId != null && providerMessageId === null)
        return null;
    // Codigo de falha vem da NOSSA lista. Texto do provedor nunca entra: ele
    // costuma repetir o destino, que e contato de paciente.
    const failureCode = raw.failureCode == null
        ? null
        : (DELIVERY_FAILURE_CODES.find((code) => code === raw.failureCode) ?? null);
    if (raw.failureCode != null && failureCode === null)
        return null;
    if (outcome === "ACCEPTED" && failureCode !== null)
        return null;
    if (outcome !== "ACCEPTED" && failureCode === null)
        return null;
    return {
        version,
        taskId,
        organizationId,
        attempt,
        outcome,
        providerMessageId,
        failureCode,
        ...(progress ? { progress } : {}),
    };
}
export function decideCallback(input) {
    const { payload, task, delivery, now } = input;
    if (!task || task.id !== payload.taskId)
        return { kind: "REJECT", why: "NOT_FOUND" };
    if (task.organizationId !== payload.organizationId)
        return { kind: "REJECT", why: "WRONG_ORGANIZATION" };
    // Progresso chega DEPOIS do resultado, com a tarefa ja concluida: exigir
    // `DISPATCHED` o recusaria sempre. O que ele exige e uma entrega que saiu.
    if (payload.progress) {
        if (!delivery || delivery.id !== task.deliveryId)
            return { kind: "REJECT", why: "DELIVERY_NOT_FOUND" };
        if (delivery.status !== "SENT")
            return { kind: "REJECT", why: "NOT_AWAITING" };
        return { kind: "PROGRESS", delivery, state: payload.progress };
    }
    // Terminal com a mesma tentativa e a reentrega do mesmo retorno; com
    // tentativa diferente, e retorno de uma tentativa que ja foi superada.
    if (isTerminalStatus(task.status)) {
        return { kind: "IGNORE", why: task.attempt === payload.attempt ? "ALREADY_APPLIED" : "STALE_ATTEMPT" };
    }
    if (payload.attempt !== task.attempt)
        return { kind: "IGNORE", why: "STALE_ATTEMPT" };
    // So tarefa entregue ao executor aceita resultado. `SCHEDULED` ou
    // `DISPATCHING` significam que o retorno chegou por um caminho que nao
    // existe — e um retorno forjado tentaria exatamente isso.
    if (task.status !== "DISPATCHED")
        return { kind: "REJECT", why: "NOT_AWAITING" };
    if (isTaskExpired(task, now))
        return { kind: "REJECT", why: "TASK_EXPIRED" };
    if (!delivery || delivery.id !== task.deliveryId)
        return { kind: "REJECT", why: "DELIVERY_NOT_FOUND" };
    return { kind: "APPLY", task, delivery };
}
/**
 * O que cada progresso carimba. Idempotente de proposito: a Meta reentrega o
 * mesmo aviso, e o primeiro instante registrado e o que vale — carimbar de novo
 * moveria para frente um horario que ja aconteceu.
 */
export function progressFields(delivery, state, now) {
    if (state === "DELIVERED") {
        return delivery.deliveredAt ? {} : { deliveredAt: now };
    }
    // Lida implica entregue: o WhatsApp as vezes entrega os dois avisos juntos, e
    // as vezes so o segundo chega.
    return {
        ...(delivery.deliveredAt ? {} : { deliveredAt: now }),
        ...(delivery.readAt ? {} : { readAt: now }),
    };
}
