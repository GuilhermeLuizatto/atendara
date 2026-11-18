import { WHATSAPP_BUTTON_LABELS } from "@/config/whatsapp";

import type { NotificationProvider, SendRequest, SendResult } from "./types";

/**
 * Cloud API da Meta — o canal oficial do WhatsApp, sem executor no meio.
 *
 * A ponte do n8n (13.3) entregava a tarefa a um executor que falava com a Meta.
 * Aqui o proprio backend fala, e por isso este provedor **nao e handoff**: a
 * resposta do pedido ja e o resultado da tentativa. "Aceito" quer dizer que a
 * Meta recebeu a mensagem para entregar, nao que o aparelho da pessoa recebeu;
 * entrega e leitura chegam depois, por webhook, e nao existem nesta fatia.
 *
 * Tres coisas que este modulo NAO faz, como no provedor da ponte:
 *
 * 1. **Nao guarda segredo.** O cabecalho de autorizacao vem de uma funcao
 *    recebida de fora (`authorization`), que nas functions le o Secret Manager.
 *    O modulo continua puro, sem variavel de ambiente, e o teste roda sem rede.
 * 2. **Nao escolhe o remetente.** O Phone Number ID chega no pedido, vindo do
 *    remetente aprovado em `messagingSenders`. Sem ele, nada sai.
 * 3. **Nao repete.** Repeticao e politica da fila (`RETRY_POLICY`). A Cloud API
 *    nao tem chave de idempotencia propria; a protecao contra envio repetido
 *    continua sendo a tarefa, com a sua `idempotencyKey`.
 */

export const META_CLOUD_TIMEOUT_MS = 10_000;
export const META_GRAPH_HOST = "https://graph.facebook.com";

export interface MetaCloudConfig {
  /** Versao da Graph API, no formato `v25.0`. */
  graphVersion: string;
  /** Valor pronto do cabecalho `Authorization`. Segredo fica fora daqui. */
  authorization: () => string;
  /** Injetados para o teste nao depender de rede nem de relogio. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  host?: string;
}

/**
 * Corpo que a Meta espera. Texto livre so vale dentro da janela de 24 horas
 * que a pessoa abriu; fora dela a Meta exige modelo aprovado. Quem decide qual
 * dos dois usar e o planejador, nao este modulo.
 */
export function metaCloudMessage(request: SendRequest): Record<string, unknown> {
  if (request.freeText && request.template) {
    throw new Error("Envio com modelo e texto livre ao mesmo tempo.");
  }

  const base = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: request.destination,
  };

  if (request.template) {
    const parameters = request.template.parameters.map((text) => ({
      type: "text",
      text,
    }));
    // Os botoes do modelo ja estao aprovados na Meta com o texto deles; o que
    // vai aqui e so o indice e o dado de cada um, na ordem do modelo.
    const buttons = request.template.buttons.map((button, index) => ({
      type: "button",
      sub_type: "quick_reply",
      index: String(index),
      parameters: [{ type: "payload", payload: button }],
    }));

    return {
      ...base,
      type: "template",
      template: {
        name: request.template.name,
        language: { code: request.template.language },
        components: [
          ...(parameters.length > 0
            ? [{ type: "body", parameters }]
            : []),
          ...buttons,
        ],
      },
    };
  }

  if (request.freeText) {
    return {
      ...base,
      type: "text",
      // Sem previa de link: o texto sai exatamente como o Atendara escreveu.
      text: { preview_url: false, body: request.body },
    };
  }

  throw new Error(
    "Envio de WhatsApp sem modelo e sem resposta em conversa: a Cloud API não teria o que mandar.",
  );
}

/** Rotulo do botao, para o teste provar que o modelo nao perde o texto. */
export function metaCloudButtonLabel(button: keyof typeof WHATSAPP_BUTTON_LABELS): string {
  return WHATSAPP_BUTTON_LABELS[button];
}

function failure(
  outcome: "TEMPORARY_FAILURE" | "REJECTED",
  failureCode: SendResult["failureCode"],
): SendResult {
  return { outcome, providerMessageId: null, failureCode };
}

/**
 * Codigo de erro da Meta -> resultado da tentativa.
 *
 * O que separa recusa de falha passageira nao e a familia do status, e sim se
 * repetir o mesmo pedido teria chance de dar certo. `131047` e o caso que o
 * tipo `OUTSIDE_REPLY_WINDOW` existe para nomear: a janela fechou, o numero
 * continua valido e volta a receber assim que a pessoa escrever de novo.
 */
export function metaCloudFailure(status: number, code: number | null): SendResult {
  if (code === 131047) return failure("REJECTED", "OUTSIDE_REPLY_WINDOW");
  if (code === 130429 || code === 131048 || status === 429) {
    return failure("TEMPORARY_FAILURE", "RATE_LIMITED");
  }
  // Token invalido, app sem permissao, numero restringido pela Meta: o pedido
  // nao esta errado, quem nao pode e o remetente.
  if (code === 190 || code === 368 || code === 131031 || status === 401 || status === 403) {
    return failure("REJECTED", "SENDER_NOT_ALLOWED");
  }
  if (status >= 500) return failure("TEMPORARY_FAILURE", "PROVIDER_UNAVAILABLE");
  return failure("REJECTED", "INVALID_DESTINATION");
}

function errorCodeOf(payload: unknown): number | null {
  const code = (payload as { error?: { code?: unknown } })?.error?.code;
  return typeof code === "number" ? code : null;
}

function messageIdOf(payload: unknown): string | null {
  const id = (payload as { messages?: { id?: unknown }[] })?.messages?.[0]?.id;
  return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
}

export function createMetaCloudApiProvider(config: MetaCloudConfig): NotificationProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? META_CLOUD_TIMEOUT_MS;
  const host = config.host ?? META_GRAPH_HOST;

  return {
    id: "META_CLOUD_API",
    simulated: false,
    handoff: false,
    async send(request: SendRequest): Promise<SendResult> {
      // Sem Phone Number ID nao da nem para montar a URL. Recusa, e nao falha
      // passageira: tentar de novo com o mesmo pedido daria no mesmo.
      if (!request.providerSenderId) {
        return failure("REJECTED", "SENDER_NOT_ALLOWED");
      }

      const body = JSON.stringify(metaCloudMessage(request));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(
          `${host}/${config.graphVersion}/${request.providerSenderId}/messages`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: config.authorization(),
            },
            body,
            signal: controller.signal,
          },
        );

        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) return metaCloudFailure(response.status, errorCodeOf(payload));

        return {
          outcome: "ACCEPTED",
          // Protocolo da Meta. Prova que ela aceitou, nao que entregou.
          providerMessageId: messageIdOf(payload),
          failureCode: null,
        };
      } catch {
        // Rede fora, tempo esgotado, DNS: nada disso diz se a mensagem saiu.
        // Falha temporaria e a unica resposta honesta.
        return failure("TEMPORARY_FAILURE", "PROVIDER_UNAVAILABLE");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
