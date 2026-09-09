/**
 * Os geradores usam a mesma aritmetica de datas da aplicacao.
 *
 * Estes helpers nasceram aqui e migraram para `@/lib/utils/datetime` quando a
 * agenda passou a precisar deles em producao. O reexport evita que "codigo de
 * mock" e "codigo de produto" divirjam no calculo de dia e fuso — se
 * divergissem, os dados de demonstracao cairiam em horarios que a agenda
 * renderiza em outro lugar.
 */
export {
  addMinutesISO,
  atTime,
  isWeekend,
  shiftDays,
  toDateKey,
  weekdayOf,
  type DateKey,
} from "@/lib/utils/datetime";
