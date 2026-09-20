import { shiftDays, toDateKey, type DateKey } from "@/lib/utils/datetime";
import type { Appointment, ID, Service } from "@/types";

/**
 * Lembrete de manutenção (E2.4), sem I/O e **sem envio**.
 *
 * Calcula quem já passou do intervalo de retorno de um serviço e devolve a
 * lista para a tela mostrar. Nada aqui cria tarefa de automação nem entrega:
 * aviso ao cliente é opt-in com as travas da regra 11, e o envio de verdade é
 * outra etapa. Esta lista serve para ela olhar e decidir — que é diferente de
 * o sistema decidir por ela.
 *
 * A unidade é o DIA DE CALENDÁRIO no fuso do produto, como o resto da agenda:
 * "voltar em 30 dias" é uma data, não um instante.
 */

export type MaintenanceStatus = "DUE" | "SOON";

export interface MaintenanceSuggestion {
  clientId: ID;
  clientName: string;
  serviceId: ID;
  serviceName: string;
  /** Quando foi o último atendimento realizado daquele serviço. */
  lastVisitOn: DateKey;
  /** Quando o retorno vence, pelo intervalo do catálogo. */
  dueOn: DateKey;
  /** Dias de atraso. Negativo quando ainda vai vencer. */
  daysLate: number;
  status: MaintenanceStatus;
}

/** Atendimento que ainda vai acontecer não entra na lista: ela já voltou. */
const UPCOMING_STATUSES = new Set(["SCHEDULED", "CONFIRMED"]);

function daysBetween(from: DateKey, to: DateKey): number {
  const a = Date.parse(`${from}T12:00:00.000Z`);
  const b = Date.parse(`${to}T12:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

export function maintenanceSuggestions(input: {
  appointments: readonly Appointment[];
  services: readonly Service[];
  now: Date;
  /** Quantos dias antes do vencimento a sugestão já aparece. */
  lookAheadDays?: number;
}): MaintenanceSuggestion[] {
  const hoje = toDateKey(input.now);
  const lookAhead = input.lookAheadDays ?? 7;
  const horizonte = shiftDays(hoje, lookAhead);

  // Só serviço com intervalo definido por ela sugere retorno.
  const comIntervalo = new Map(
    input.services
      .filter((service) => service.returnIntervalDays !== null)
      .map((service) => [service.id, service]),
  );
  if (comIntervalo.size === 0) return [];

  const chave = (clientId: ID, serviceId: ID) => `${clientId}::${serviceId}`;

  // Quem já tem horário marcado daquele serviço sai da lista.
  const jaVoltou = new Set<string>();
  for (const appointment of input.appointments) {
    if (!appointment.serviceId || !UPCOMING_STATUSES.has(appointment.status))
      continue;
    jaVoltou.add(chave(appointment.clientId, appointment.serviceId));
  }

  // O último atendimento REALIZADO de cada par cliente × serviço.
  const ultimos = new Map<string, Appointment>();
  for (const appointment of input.appointments) {
    if (appointment.status !== "COMPLETED" || !appointment.serviceId) continue;
    if (!comIntervalo.has(appointment.serviceId)) continue;

    const id = chave(appointment.clientId, appointment.serviceId);
    const atual = ultimos.get(id);
    if (!atual || appointment.startsAt > atual.startsAt)
      ultimos.set(id, appointment);
  }

  const sugestoes: MaintenanceSuggestion[] = [];
  for (const [id, appointment] of ultimos) {
    if (jaVoltou.has(id)) continue;

    const service = comIntervalo.get(appointment.serviceId!)!;
    const lastVisitOn = toDateKey(new Date(appointment.startsAt));
    const dueOn = shiftDays(lastVisitOn, service.returnIntervalDays!);
    if (dueOn > horizonte) continue;

    sugestoes.push({
      clientId: appointment.clientId,
      clientName: appointment.clientName,
      serviceId: service.id,
      // O nome do catálogo, e não o do atendimento: a lista é sobre voltar a
      // fazer o serviço, e ele pode ter sido renomeado desde então.
      serviceName: service.name,
      lastVisitOn,
      dueOn,
      daysLate: daysBetween(dueOn, hoje),
      status: dueOn <= hoje ? "DUE" : "SOON",
    });
  }

  // Mais atrasada primeiro; empate resolve por nome, para a lista não dançar.
  return sugestoes.sort(
    (a, b) =>
      b.daysLate - a.daysLate ||
      a.clientName.localeCompare(b.clientName, "pt-BR"),
  );
}
