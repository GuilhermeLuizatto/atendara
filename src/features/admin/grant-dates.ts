import { MAX_ACCESS_GRANT_DAYS } from "@/config/platform";

const DAY_MS = 86_400_000;
const SAO_PAULO_OFFSET_MS = 3 * 3_600_000;

/** `AAAA-MM-DD` no horario de Brasilia, deslocado em dias a partir de agora. */
export function dateInputValue(offsetDays: number, now = new Date()): string {
  return new Date(now.getTime() + offsetDays * DAY_MS - SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10);
}

/** Fim do dia escolhido, em Brasilia — o mesmo criterio usado desde o cadastro. */
export function untilFromDateInput(value: string): string {
  return new Date(`${value}T23:59:59-03:00`).toISOString();
}

/**
 * Ultimo dia oferecido no seletor. Um a menos que o prazo maximo: o fim do dia
 * escolhido nunca passa de agora + prazo, e o servidor nao recusa o que a tela
 * ofereceu.
 */
export const LATEST_GRANT_OFFSET_DAYS = MAX_ACCESS_GRANT_DAYS - 1;
