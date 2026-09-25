import {
  ASSISTANT_NAME,
  CONVERSATION_REPLY_TEXTS,
  REPLY_MAX_BODY_LENGTH,
  REPLY_VARIABLES,
  type ReplyVariable,
} from "@/config/assistant";
import { RESCHEDULE_HOLD_MINUTES } from "@/config/reschedule";
import { formatTime, formatWeekday } from "@/lib/utils/format";
import { err, ok, type ConversationReplyEvent, type ISODateString, type ReplyStage, type Result } from "@/types";

import { hasForbiddenTerm, type TemplateRejection } from "./templates";

/**
 * O texto de uma resposta da assistente na conversa.
 *
 * Irmão de `renderTemplate`, e não uma opção dele, por um motivo: o aviso é
 * uma linha só (o renderizador de avisos junta todo espaço em branco), e a
 * oferta precisa de uma opção por linha. As barreiras são as mesmas — lista
 * fechada de variáveis, vocabulário proibido no modelo e no texto final, e teto
 * de tamanho.
 */

export interface ReplyContext {
  clientName: string;
  organizationName: string;
  /** Horário novo, na confirmação. */
  startsAt?: ISODateString | null;
  /** Horários oferecidos, na ordem em que a pessoa vai escolher. */
  slots?: readonly { startsAt: ISODateString }[];
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** "quarta-feira, 30 de setembro, às 08:00" — sem ano: a oferta é de dias próximos. */
function when(startsAt: ISODateString): string {
  return `${formatWeekday(startsAt)}, às ${formatTime(startsAt)}`;
}

function valuesFor(context: ReplyContext): Record<ReplyVariable, string | null> {
  const slots = context.slots ?? [];
  return {
    clientName: context.clientName.trim() || null,
    organizationName: context.organizationName.trim() || null,
    assistantName: ASSISTANT_NAME,
    date: context.startsAt ? formatWeekday(context.startsAt) : null,
    time: context.startsAt ? formatTime(context.startsAt) : null,
    slotOptions: slots.length
      ? slots.map((slot, index) => `${index + 1}. ${when(slot.startsAt)}`).join("\n")
      : null,
    holdMinutes: String(RESCHEDULE_HOLD_MINUTES),
  };
}

export function renderReply(
  event: ConversationReplyEvent,
  stage: ReplyStage,
  context: ReplyContext,
): Result<string, TemplateRejection> {
  const paragraphs = CONVERSATION_REPLY_TEXTS[event][stage];
  if (paragraphs.length === 0) return err("EMPTY");
  if (paragraphs.some(hasForbiddenTerm)) return err("FORBIDDEN_TERM");

  const known = new Set<string>(REPLY_VARIABLES);
  const values = valuesFor(context);
  let rejection: TemplateRejection | null = null;

  const body = paragraphs
    .map((paragraph) =>
      paragraph
        .replace(PLACEHOLDER, (match, name: string) => {
          if (!known.has(name)) {
            rejection ??= "UNKNOWN_VARIABLE";
            return match;
          }
          const value = values[name as ReplyVariable];
          // Valor ausente é resposta pela metade ("ficou para , às"): não sai.
          if (value === null) {
            rejection ??= "EMPTY";
            return match;
          }
          return value;
        })
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .join("\n"),
    )
    .join("\n\n")
    .trim();

  if (rejection) return err(rejection);
  if (!body) return err("EMPTY");
  if (hasForbiddenTerm(body)) return err("FORBIDDEN_TERM");
  if (body.length > REPLY_MAX_BODY_LENGTH) return err("TOO_LONG");

  return ok(body);
}
