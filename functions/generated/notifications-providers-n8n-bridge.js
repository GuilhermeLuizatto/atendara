// Gerado por scripts/build-functions.mjs.
import { BRIDGE_SIGNATURE_HEADER, BRIDGE_TIMESTAMP_HEADER, bridgeTaskPayload } from "./automation-bridge.js";
/** Tempo maximo esperando o n8n aceitar. Menor que o prazo do despachante. */
export const BRIDGE_TIMEOUT_MS = 10_000;
function failure(code) {
    return { outcome: code === "INVALID_DESTINATION" ? "REJECTED" : "TEMPORARY_FAILURE", providerMessageId: null, failureCode: code };
}
/**
 * Resposta HTTP do n8n -> resultado da tentativa.
 *
 * `429` e `5xx` sao passageiros e ganham nova tentativa; `4xx` e recusa do
 * proprio contrato (assinatura, formato, tarefa vencida) e NAO ganha, porque
 * repetir o mesmo pedido invalido daria o mesmo erro.
 */
function fromStatus(status) {
    if (status === 429)
        return failure("RATE_LIMITED");
    if (status >= 500)
        return failure("PROVIDER_UNAVAILABLE");
    return failure("INVALID_DESTINATION");
}
export function createN8nBridgeProvider(config) {
    const fetchImpl = config.fetchImpl ?? fetch;
    const clock = config.clock ?? (() => new Date());
    const timeoutMs = config.timeoutMs ?? BRIDGE_TIMEOUT_MS;
    return {
        id: "N8N_BRIDGE",
        simulated: false,
        handoff: true,
        async send(request) {
            const timestamp = clock().toISOString();
            // Assina o corpo EXATO que vai no pedido, e nao o objeto: reserializar do
            // outro lado mudaria um espaco e derrubaria a conferencia.
            const body = JSON.stringify(bridgeTaskPayload(request));
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetchImpl(config.webhookUrl, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        [BRIDGE_TIMESTAMP_HEADER]: timestamp,
                        [BRIDGE_SIGNATURE_HEADER]: config.sign(timestamp, body),
                    },
                    body,
                    signal: controller.signal,
                });
                if (!response.ok)
                    return fromStatus(response.status);
                return {
                    outcome: "ACCEPTED",
                    // Protocolo do executor, quando ele devolve um. Nao e prova de
                    // entrega: prova de entrega so chega pelo `automationCallback`.
                    providerMessageId: await handoffIdOf(response),
                    failureCode: null,
                };
            }
            catch {
                // Rede fora, tempo esgotado, DNS: nada disso diz se a tarefa entrou.
                // Falha temporaria e a unica resposta honesta.
                return failure("PROVIDER_UNAVAILABLE");
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
async function handoffIdOf(response) {
    try {
        const data = await response.json();
        const id = data?.handoffId;
        return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
    }
    catch {
        // Corpo vazio ou que nao e JSON: o aceite continua valendo pelo status.
        return null;
    }
}
