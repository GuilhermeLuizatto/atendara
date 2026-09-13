// Gerado por scripts/build-functions.mjs.
import { hashBody } from "./notifications-templates.js";
/**
 * Provedor simulado — o unico que existe.
 *
 * Nao abre conexao, nao le variavel de ambiente e nao conhece credencial:
 * `send` e uma funcao do pedido para o resultado. Isso e o que permite exercitar
 * duplicidade, tentativas e estados de entrega em teste sem que exista o risco
 * de uma mensagem sair para uma pessoa real.
 *
 * O resultado e escolhido pelo DESTINO, e nao por sorteio, para que os testes
 * sejam deterministicos e legiveis: um numero reservado descreve, no proprio
 * valor, o que vai acontecer com ele.
 */
/**
 * Destinos ficticios reservados. Os prefixos de telefone usam DDD 00, que nao
 * existe no Brasil, e os dominios de e-mail sao `.invalid`, reservado pela
 * RFC 2606 justamente para nunca ser resolvido.
 */
export const SIMULATED_DESTINATIONS = {
    /** Recusa definitiva: nao ganha nova tentativa. */
    invalid: ["+550000000001", "recusado@exemplo.invalid"],
    /** Falha temporaria em toda tentativa: termina em tentativas esgotadas. */
    alwaysUnavailable: ["+550000000002", "indisponivel@exemplo.invalid"],
    /** Falha na primeira tentativa e e aceito na segunda. */
    recoversOnRetry: ["+550000000003", "instavel@exemplo.invalid"],
    /** Limite de taxa: falha temporaria, retentavel. */
    rateLimited: ["+550000000004", "limitado@exemplo.invalid"],
};
function matches(destination, group) {
    return group.some((value) => value === destination.toLowerCase());
}
function decide(request) {
    const destination = request.destination.toLowerCase();
    if (matches(destination, SIMULATED_DESTINATIONS.invalid)) {
        return {
            outcome: "REJECTED",
            providerMessageId: null,
            failureCode: "INVALID_DESTINATION",
        };
    }
    if (matches(destination, SIMULATED_DESTINATIONS.alwaysUnavailable)) {
        return {
            outcome: "TEMPORARY_FAILURE",
            providerMessageId: null,
            failureCode: "PROVIDER_UNAVAILABLE",
        };
    }
    if (matches(destination, SIMULATED_DESTINATIONS.rateLimited)) {
        return {
            outcome: "TEMPORARY_FAILURE",
            providerMessageId: null,
            failureCode: "RATE_LIMITED",
        };
    }
    if (matches(destination, SIMULATED_DESTINATIONS.recoversOnRetry) &&
        request.attempt === 1) {
        return {
            outcome: "TEMPORARY_FAILURE",
            providerMessageId: null,
            failureCode: "PROVIDER_UNAVAILABLE",
        };
    }
    return {
        outcome: "ACCEPTED",
        // Identificador estavel para o mesmo pedido: reentregar o mesmo aviso nao
        // inventa um protocolo diferente a cada execucao.
        providerMessageId: `sim_${hashBody(`${request.deliveryId}:${request.attempt}`)}`,
        failureCode: null,
    };
}
export function createSimulatedProvider() {
    return {
        id: "SIMULATED",
        simulated: true,
        async send(request) {
            return decide(request);
        },
    };
}
