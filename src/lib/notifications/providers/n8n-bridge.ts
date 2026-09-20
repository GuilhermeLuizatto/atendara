import { BRIDGE_SIGNATURE_HEADER, BRIDGE_TIMESTAMP_HEADER, bridgeTaskPayload } from "@/lib/automation/bridge";

import type { NotificationProvider, SendRequest, SendResult } from "./types";

/**
 * Ponte com o n8n (Fase 3, 13.3).
 *
 * O n8n **executa**; quem decide continua sendo o Atendara. Este arquivo e a
 * metade do contrato que sai: monta o minimo da secao 3 do plano, assina e
 * entrega. A metade que volta e a function `automationCallback`.
 *
 * Tres coisas que este provedor NAO faz, de proposito:
 *
 * 1. **Nao guarda segredo.** A assinatura e feita por uma funcao recebida de
 *    fora (`sign`), que nas functions vem do Secret Manager. Assim este modulo
 *    continua puro, sem `node:crypto` nem variavel de ambiente, e o teste roda
 *    sem emulador.
 * 2. **Nao decide resultado.** `ACCEPTED` aqui significa "o n8n aceitou a
 *    tarefa", e nada mais: `handoff: true` obriga o despachante a deixar a
 *    tarefa em `DISPATCHED` esperando o retorno assinado.
 * 3. **Nao repete.** Repeticao e politica da fila (`RETRY_POLICY`), conferida
 *    contra o estado atual. Aqui, falha de rede vira falha temporaria e acabou.
 */

export interface BridgeConfig {
  /** Webhook do n8n. HTTPS em producao; `http://localhost` so no n8n local. */
  webhookUrl: string;
  /** HMAC-SHA256 do corpo com o horario, em hexadecimal. Segredo A. */
  sign: (timestamp: string, body: string) => string;
  /** Injetados para o teste nao depender de rede nem de relogio. */
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  timeoutMs?: number;
}

/** Tempo maximo esperando o n8n aceitar. Menor que o prazo do despachante. */
export const BRIDGE_TIMEOUT_MS = 10_000;

function failure(code: "PROVIDER_UNAVAILABLE" | "INVALID_DESTINATION" | "RATE_LIMITED"): SendResult {
  return { outcome: code === "INVALID_DESTINATION" ? "REJECTED" : "TEMPORARY_FAILURE", providerMessageId: null, failureCode: code };
}

/**
 * Resposta HTTP do n8n -> resultado da tentativa.
 *
 * `429` e `5xx` sao passageiros e ganham nova tentativa; `4xx` e recusa do
 * proprio contrato (assinatura, formato, tarefa vencida) e NAO ganha, porque
 * repetir o mesmo pedido invalido daria o mesmo erro.
 */
function fromStatus(status: number): SendResult {
  if (status === 429) return failure("RATE_LIMITED");
  if (status >= 500) return failure("PROVIDER_UNAVAILABLE");
  return failure("INVALID_DESTINATION");
}

export function createN8nBridgeProvider(config: BridgeConfig): NotificationProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const clock = config.clock ?? (() => new Date());
  const timeoutMs = config.timeoutMs ?? BRIDGE_TIMEOUT_MS;

  return {
    id: "N8N_BRIDGE",
    simulated: false,
    handoff: true,
    async send(request: SendRequest): Promise<SendResult> {
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

        if (!response.ok) return fromStatus(response.status);
        return {
          outcome: "ACCEPTED",
          // Protocolo do executor, quando ele devolve um. Nao e prova de
          // entrega: prova de entrega so chega pelo `automationCallback`.
          providerMessageId: await handoffIdOf(response),
          failureCode: null,
        };
      } catch {
        // Rede fora, tempo esgotado, DNS: nada disso diz se a tarefa entrou.
        // Falha temporaria e a unica resposta honesta.
        return failure("PROVIDER_UNAVAILABLE");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function handoffIdOf(response: Response): Promise<string | null> {
  try {
    const data: unknown = await response.json();
    const id = (data as { handoffId?: unknown })?.handoffId;
    return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
  } catch {
    // Corpo vazio ou que nao e JSON: o aceite continua valendo pelo status.
    return null;
  }
}
