import type { AgendaSettings, ISODateString } from "@/types";

/**
 * Horários livres, sem I/O (Fase 3, 13.6).
 *
 * Uma função do estado da agenda para uma lista de horários. Nada aqui lê
 * banco, olha relógio sozinho ou decide política — decidir **se** a pessoa pode
 * remarcar é de `src/config/reschedule.ts`; aqui só se responde **quando** há
 * vaga.
 *
 * Três coisas que este arquivo trata como verdade, e que explicam o formato:
 *
 * 1. **Ocupado é ocupado, venha de onde vier.** Atendimento do Atendara e bloco
 *    externo (a agenda pessoal lida do Google, na 13.7) entram na mesma lista.
 *    Oferecer horário que já tem compromisso pessoal é pior do que oferecer
 *    menos horários.
 * 2. **O intervalo entre atendimentos é do profissional, não do relógio.** Ele
 *    separa um atendimento do seguinte; não é arredondamento de horário.
 * 3. **Fuso é do lado de fora.** Tudo aqui é instante absoluto (ISO em UTC), e
 *    quem transforma "08:00 do expediente" em instante é quem conhece o fuso da
 *    organização. Misturar os dois é como nasce o erro de uma hora.
 */

export interface BusyBlock {
  startsAt: ISODateString;
  endsAt: ISODateString;
}

export interface AvailabilityInput {
  /** Expediente, dias de atendimento e intervalo entre horários. */
  agenda: Pick<AgendaSettings, "workingDays" | "workdayStart" | "workdayEnd" | "slotIntervalMinutes">;
  /** Duração do atendimento a encaixar, em minutos. */
  durationMinutes: number;
  /** Folga exigida entre um atendimento e o seguinte, em minutos. */
  bufferMinutes: number;
  /** Janela de busca, em instantes absolutos. */
  from: ISODateString;
  to: ISODateString;
  /** Atendimentos e blocos externos que ocupam a agenda. */
  busy: readonly BusyBlock[];
  /**
   * Deslocamento do fuso da organização em minutos (ex.: -180 para Brasília).
   * O expediente é lido nesse fuso; a resposta sai em instante absoluto.
   */
  timezoneOffsetMinutes: number;
}

export interface AvailableSlot {
  startsAt: ISODateString;
  endsAt: ISODateString;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** Instante -> data e hora no fuso da organização, como minutos desde a meia-noite. */
function localParts(iso: ISODateString, offsetMinutes: number): { dayStartMs: number; weekday: number } {
  const local = new Date(Date.parse(iso) + offsetMinutes * MINUTE_MS);
  const dayStartMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMinutes * MINUTE_MS;
  return { dayStartMs, weekday: local.getUTCDay() };
}

function overlaps(startMs: number, endMs: number, block: BusyBlock, bufferMs: number): boolean {
  const busyStart = Date.parse(block.startsAt) - bufferMs;
  const busyEnd = Date.parse(block.endsAt) + bufferMs;
  return startMs < busyEnd && busyStart < endMs;
}

/**
 * Todos os horários livres da janela, em ordem.
 *
 * O passo é `slotIntervalMinutes`, e cada candidato precisa caber **inteiro**
 * dentro do expediente do dia: um atendimento de 50 minutos não começa às
 * 17:30 num expediente que fecha às 18:00.
 */
export function availableSlots(input: AvailabilityInput): AvailableSlot[] {
  const { agenda, durationMinutes, bufferMinutes, timezoneOffsetMinutes: offset } = input;
  if (durationMinutes <= 0 || agenda.slotIntervalMinutes <= 0) return [];

  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];

  const startMinutes = minutesOfDay(agenda.workdayStart);
  const endMinutes = minutesOfDay(agenda.workdayEnd);
  const bufferMs = Math.max(0, bufferMinutes) * MINUTE_MS;
  const durationMs = durationMinutes * MINUTE_MS;
  const stepMs = agenda.slotIntervalMinutes * MINUTE_MS;

  const slots: AvailableSlot[] = [];
  let { dayStartMs } = localParts(input.from, offset);

  while (dayStartMs <= toMs) {
    const { weekday } = localParts(new Date(dayStartMs).toISOString(), offset);
    if (agenda.workingDays.includes(weekday)) {
      const openMs = dayStartMs + startMinutes * MINUTE_MS;
      const closeMs = dayStartMs + endMinutes * MINUTE_MS;

      for (let candidate = openMs; candidate + durationMs <= closeMs; candidate += stepMs) {
        const endsMs = candidate + durationMs;
        if (candidate < fromMs || endsMs > toMs) continue;
        if (input.busy.some((block) => overlaps(candidate, endsMs, block, bufferMs))) continue;
        slots.push({ startsAt: new Date(candidate).toISOString(), endsAt: new Date(endsMs).toISOString() });
      }
    }
    dayStartMs += DAY_MS;
  }
  return slots;
}

/** Os primeiros `limit` horários livres. É o que a oferta pelo canal usa. */
export function firstAvailableSlots(input: AvailabilityInput, limit: number): AvailableSlot[] {
  return limit <= 0 ? [] : availableSlots(input).slice(0, limit);
}

/**
 * O horário ainda está livre?
 *
 * Conferido de novo **dentro da transação** que reserva: entre oferecer e
 * escolher, alguém pode ter marcado. É esta função que impede dois atendimentos
 * no mesmo horário.
 */
export function isSlotFree(
  slot: AvailableSlot,
  busy: readonly BusyBlock[],
  bufferMinutes: number,
): boolean {
  const startMs = Date.parse(slot.startsAt);
  const endMs = Date.parse(slot.endsAt);
  return !busy.some((block) => overlaps(startMs, endMs, block, Math.max(0, bufferMinutes) * MINUTE_MS));
}
