import { INBOUND_OPT_OUT_TERMS, INBOUND_WINDOW_HOURS } from "@/config/inbound";
import type { WhatsappTemplateButton } from "@/config/whatsapp";
import type { ID, ISODateString } from "@/types";

/**
 * A mensagem que CHEGA (Fase 3, 13.5), sem I/O.
 *
 * Tudo aqui é leitura de um corpo que veio de fora, e a postura é a mesma do
 * resto da fila: **nada do corpo é aceito como verdade** além do que a Meta
 * assina. Quem é a organização sai do remetente cadastrado; quem é a pessoa
 * sai do telefone normalizado **dentro daquela organização**; o que a mensagem
 * significa sai do motor de decisão, não do texto.
 *
 * O que este arquivo se recusa a fazer:
 *
 * - **procurar o número em outra organização.** Número desconhecido vira
 *   conversa sem vínculo, e nada mais. Procurar em outra clínica seria dizer a
 *   uma delas que aquela pessoa é atendida na outra;
 * - **responder fora da janela de 24 horas.** Fora dela o WhatsApp só entrega
 *   modelo aprovado, e responder texto livre seria falar sozinho;
 * - **decidir sozinho.** Classificação, regra e permissão continuam com o motor
 *   (`lib/ai/decision-engine.ts`); aqui só se prepara a entrada e se traduz a
 *   saída em fatos a gravar.
 */

/** O que o n8n repassa, já separado por tipo. */
export type InboundEvent =
  | {
      kind: "TEXT";
      providerSenderId: string;
      from: string;
      providerMessageId: string;
      text: string;
      sentAt: ISODateString;
    }
  | {
      kind: "BUTTON";
      providerSenderId: string;
      from: string;
      providerMessageId: string;
      /** Identificador do botão, como o modelo o cadastrou na Meta. */
      button: WhatsappTemplateButton;
      /** Mensagem a que a pessoa respondeu, quando a Meta a informa. */
      repliedTo: string | null;
      sentAt: ISODateString;
    };

const BUTTONS: Record<string, WhatsappTemplateButton> = {
  CONFIRMAR: "CONFIRM",
  CONFIRM: "CONFIRM",
  REMARCAR: "RESCHEDULE",
  RESCHEDULE: "RESCHEDULE",
};

/** Sem acento, sem espaço em volta e em maiúsculas: gente digita como quer. */
export function foldInbound(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/**
 * Telefone da Meta (só dígitos, com país) para o formato do cadastro (`+`).
 * Sem heurística de DDI: o que não parece telefone volta `null`, e número que
 * não normaliza não encontra ninguém — o que é melhor do que encontrar a pessoa
 * errada.
 */
export function normalizeInboundPhone(value: string): string | null {
  if (!/^\+?[\d\s()-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

/**
 * Lê o corpo do webhook da Meta. Tudo o que não for mensagem de texto ou
 * resposta de botão é ignorado. O aceite da API não comprova entrega: eventos
 * de status precisam de tratamento próprio, separado das mensagens recebidas.
 */
export function parseInboundPayload(data: unknown): InboundEvent[] {
  if (typeof data !== "object" || data === null) return [];
  const entries = (data as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const events: InboundEvent[] = [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: unknown })?.value as
        | { metadata?: { phone_number_id?: unknown }; messages?: unknown }
        | undefined;
      const providerSenderId = value?.metadata?.phone_number_id;
      if (
        typeof providerSenderId !== "string" ||
        !Array.isArray(value?.messages)
      )
        continue;

      for (const message of value.messages) {
        if (typeof message !== "object" || message === null) continue;
        const raw = message as Record<string, unknown>;
        const from = typeof raw.from === "string" ? raw.from : null;
        const id = typeof raw.id === "string" ? raw.id : null;
        const seconds =
          typeof raw.timestamp === "string" && /^\d+$/.test(raw.timestamp)
            ? Number(raw.timestamp)
            : NaN;
        const instant = new Date(seconds * 1000);
        if (
          !from ||
          !normalizeInboundPhone(from) ||
          !id ||
          !/^[\x21-\x7e]{1,256}$/.test(id) ||
          !Number.isSafeInteger(seconds) ||
          seconds <= 0 ||
          !Number.isFinite(instant.getTime())
        )
          continue;
        const sentAt = instant.toISOString();

        if (raw.type === "text") {
          const text = (raw.text as { body?: unknown })?.body;
          if (typeof text !== "string" || !text.trim()) continue;
          events.push({
            kind: "TEXT",
            providerSenderId,
            from,
            providerMessageId: id,
            text: text.trim(),
            sentAt,
          });
          continue;
        }

        if (raw.type === "button") {
          const payload = (raw.button as { payload?: unknown; text?: unknown })
            ?.payload;
          const label = (raw.button as { text?: unknown })?.text;
          const button = BUTTONS[foldInbound(String(payload ?? label ?? ""))];
          if (!button) continue;
          const context = (raw.context as { id?: unknown })?.id;
          events.push({
            kind: "BUTTON",
            providerSenderId,
            from,
            providerMessageId: id,
            button,
            repliedTo: typeof context === "string" ? context : null,
            sentAt,
          });
        }
      }
    }
  }
  return events;
}

/** A janela em que o WhatsApp aceita texto livre, aberta pela pessoa. */
export function inboundWindowEndsAt(sentAt: ISODateString): ISODateString {
  return new Date(
    Date.parse(sentAt) + INBOUND_WINDOW_HOURS * 3_600_000,
  ).toISOString();
}

export function isWithinInboundWindow(
  windowEndsAt: ISODateString | null,
  now: ISODateString,
): boolean {
  return windowEndsAt !== null && Date.parse(now) < Date.parse(windowEndsAt);
}

/** A pessoa pediu para parar de receber. Vale em qualquer capitalização. */
export function isOptOut(text: string): boolean {
  return INBOUND_OPT_OUT_TERMS.includes(foldInbound(text));
}

export type InboundDecision =
  /** Reentrega da Meta: a mesma mensagem já foi gravada. */
  | { kind: "DUPLICATE" }
  /**
   * Chegou atrasada, depois de outra mais nova. É gravada — a conversa é
   * prova —, mas não muda o resumo nem a atenção da conversa.
   */
  | { kind: "OUT_OF_ORDER" }
  /** Retirar o consentimento do canal, com registro. */
  | { kind: "OPT_OUT" }
  /** A pessoa confirmou pelo botão. */
  | { kind: "CONFIRM" }
  /** A pessoa pediu para remarcar: a oferta de horários é a 13.6. */
  | { kind: "RESCHEDULE" }
  /** Texto comum: vai ao motor de decisão. */
  | { kind: "CLASSIFY" };

export function decideInbound(input: {
  event: InboundEvent;
  /** Ids de mensagens do provedor já gravadas nesta conversa. */
  knownProviderMessageIds: readonly string[];
  /** Instante da última mensagem recebida nesta conversa. */
  lastInboundAt: ISODateString | null;
}): InboundDecision {
  const { event, knownProviderMessageIds, lastInboundAt } = input;

  // A Meta reentrega o mesmo webhook quando não recebe 200 a tempo. Sem esta
  // trava, uma reentrega viraria segunda mensagem, segunda decisão e segunda
  // resposta automática.
  if (knownProviderMessageIds.includes(event.providerMessageId))
    return { kind: "DUPLICATE" };

  // Pedido de saída vale mesmo atrasado: quem pediu para parar pediu.
  if (event.kind === "TEXT" && isOptOut(event.text)) return { kind: "OPT_OUT" };

  if (event.kind === "BUTTON") {
    if (lastInboundAt && Date.parse(event.sentAt) < Date.parse(lastInboundAt))
      return { kind: "OUT_OF_ORDER" };
    return event.button === "CONFIRM"
      ? { kind: "CONFIRM" }
      : { kind: "RESCHEDULE" };
  }

  if (lastInboundAt && Date.parse(event.sentAt) < Date.parse(lastInboundAt)) {
    return { kind: "OUT_OF_ORDER" };
  }
  return { kind: "CLASSIFY" };
}

/**
 * A conversa de WhatsApp de uma pessoa. Por cadastro quando ha vinculo; por
 * numero quando nao ha — numero desconhecido conversa com a clinica sem virar
 * cadastro sozinho. O despachante usa a mesma regra para achar a conversa de
 * uma resposta sem que a tarefa guarde o id dela.
 */
export function whatsappConversationId(clientId: ID | null, phone: string): ID {
  return clientId ? `wa-${clientId}` : `wa-anonimo-${phone}`;
}

/** Identidade estável da mensagem recebida, derivada do id da Meta. */
export function inboundMessageId(providerMessageId: string): ID {
  // A codificação preserva a identidade: retirar pontuação ou truncar fundiria
  // mensagens diferentes, descartando uma delas como reentrega.
  return `wa-${encodeURIComponent(providerMessageId)}`;
}
