import type { BusyBlock } from "@/lib/agenda/availability";
import { atTime, minutesIntoDay, shiftDays, type DateKey } from "@/lib/utils/datetime";
import type { Appointment } from "@/types";

export interface PositionedBusy {
  /** Trecho da faixa que cai neste dia, para o rótulo. */
  startsAt: string;
  endsAt: string;
  top: number;
  height: number;
}

/**
 * Faixas de ocupado do Google recortadas ao dia e à janela de horas da grade.
 * Uma faixa que atravessa a meia-noite aparece nos dois dias.
 */
export function layoutBusy(
  blocks: readonly BusyBlock[],
  dateKey: DateKey,
  startHour: number,
  endHour: number,
  pixelsPerHour: number,
): PositionedBusy[] {
  const dayStart = Date.parse(atTime(dateKey, 0));
  const dayEnd = Date.parse(atTime(shiftDays(dateKey, 1), 0));
  const result: PositionedBusy[] = [];
  for (const block of blocks) {
    const start = Math.max(Date.parse(block.startsAt), dayStart);
    const end = Math.min(Date.parse(block.endsAt), dayEnd);
    if (end <= start) continue;
    const startsAt = new Date(start).toISOString();
    const endsAt = new Date(end).toISOString();
    const fromMinute = Math.max(minutesIntoDay(startsAt), startHour * 60);
    // O fim no começo do dia seguinte vale 24:00, não 00:00.
    const untilMinute = Math.min(end === dayEnd ? 24 * 60 : minutesIntoDay(endsAt), endHour * 60);
    if (untilMinute <= fromMinute) continue;
    result.push({
      startsAt,
      endsAt,
      top: (fromMinute - startHour * 60) * (pixelsPerHour / 60),
      height: (untilMinute - fromMinute) * (pixelsPerHour / 60),
    });
  }
  return result;
}

export interface PositionedAppointment {
  appointment: Appointment;
  /** Deslocamento do topo, em pixels, dentro da coluna do dia. */
  top: number;
  height: number;
  /** Faixa horizontal ocupada, para atendimentos simultaneos. */
  lane: number;
  lanes: number;
}

const MIN_BLOCK_HEIGHT = 22;

/**
 * Posiciona os atendimentos na grade do dia.
 *
 * Atendimentos que se sobrepoem no tempo sao distribuidos em faixas lado a
 * lado. Sem isso, dois horarios simultaneos (dois profissionais, ou um encaixe)
 * ficariam empilhados e um esconderia o outro.
 *
 * O algoritmo agrupa em "clusters" de sobreposicao encadeada e faz atribuicao
 * gulosa de faixa dentro de cada cluster — suficiente e previsivel para o
 * volume de uma agenda diaria.
 */
export function layoutDay(
  appointments: Appointment[],
  startHour: number,
  pixelsPerHour: number,
): PositionedAppointment[] {
  const sorted = [...appointments].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );

  const positioned: PositionedAppointment[] = [];
  let cluster: PositionedAppointment[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = laneEnds.length || 1;
    for (const item of cluster) item.lanes = lanes;
    positioned.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const appointment of sorted) {
    const start = minutesIntoDay(appointment.startsAt);
    const end = start + appointment.durationMinutes;

    // Sem sobreposicao com o cluster corrente: fecha e comeca outro.
    if (start >= clusterEnd && cluster.length > 0) flush();

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }

    cluster.push({
      appointment,
      top: ((start - startHour * 60) / 60) * pixelsPerHour,
      height: Math.max(
        MIN_BLOCK_HEIGHT,
        (appointment.durationMinutes / 60) * pixelsPerHour,
      ),
      lane,
      lanes: 1,
    });

    clusterEnd = Math.max(clusterEnd, end);
  }

  if (cluster.length > 0) flush();
  return positioned;
}

/** Faixa de horas a exibir: cobre o expediente e tudo o que estiver agendado. */
export function visibleHourRange(
  appointments: Appointment[],
  workdayStart: string,
  workdayEnd: string,
): { startHour: number; endHour: number } {
  let startHour = Number(workdayStart.slice(0, 2));
  let endHour = Number(workdayEnd.slice(0, 2));

  for (const appointment of appointments) {
    const start = Math.floor(minutesIntoDay(appointment.startsAt) / 60);
    const end = Math.ceil(
      (minutesIntoDay(appointment.startsAt) + appointment.durationMinutes) / 60,
    );
    startHour = Math.min(startHour, start);
    endHour = Math.max(endHour, end);
  }

  return {
    startHour: Math.max(0, startHour),
    endHour: Math.min(24, Math.max(endHour, startHour + 1)),
  };
}
