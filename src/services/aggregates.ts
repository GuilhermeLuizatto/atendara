import type { Appointment, Client, ISODateString, Transaction } from "@/types";

/**
 * Recalculo dos campos desnormalizados do cliente.
 *
 * `lastAppointmentAt`, `nextAppointmentAt`, `totalAppointments` e o saldo em
 * aberto sao derivados — existem no documento apenas para a listagem do CRM
 * nao precisar varrer agenda e financeiro a cada linha.
 *
 * Em producao isso vira uma Cloud Function disparada por escrita em
 * `appointments` e `transactions`. Aqui roda em memoria depois de cada mutacao,
 * pelo mesmo motivo: manter o CRM coerente com a agenda sem a tela recalcular.
 */
export function recomputeClientAggregates(
  clients: Client[],
  appointments: Appointment[],
  transactions: Transaction[],
  now: ISODateString,
): Client[] {
  const byClient = new Map<
    string,
    { completed: Appointment[]; upcoming: Appointment[] }
  >();

  for (const appointment of appointments) {
    const bucket = byClient.get(appointment.clientId) ?? {
      completed: [],
      upcoming: [],
    };

    if (appointment.status === "COMPLETED") {
      bucket.completed.push(appointment);
    } else if (
      appointment.startsAt > now &&
      (appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED")
    ) {
      bucket.upcoming.push(appointment);
    }

    byClient.set(appointment.clientId, bucket);
  }

  const balances = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== "INCOME" || !transaction.clientId) continue;
    if (transaction.status !== "PENDING" && transaction.status !== "OVERDUE") {
      continue;
    }
    balances.set(
      transaction.clientId,
      (balances.get(transaction.clientId) ?? 0) + transaction.amountInCents,
    );
  }

  return clients.map((client) => {
    const bucket = byClient.get(client.id);
    const completed = (bucket?.completed ?? []).sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    );
    const upcoming = (bucket?.upcoming ?? []).sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    );

    return {
      ...client,
      totalAppointments: completed.length,
      lastAppointmentAt: completed.at(-1)?.startsAt ?? null,
      nextAppointmentAt: upcoming[0]?.startsAt ?? null,
      outstandingBalanceInCents: balances.get(client.id) ?? 0,
    };
  });
}

/**
 * Marca como atrasada toda receita pendente cuja data de vencimento ja passou.
 * Roda a cada mutacao para que o financeiro nao dependa de um job noturno.
 */
export function markOverdue(
  transactions: Transaction[],
  now: ISODateString,
): Transaction[] {
  let changed = false;

  const next = transactions.map((transaction) => {
    const shouldBeOverdue =
      transaction.type === "INCOME" &&
      transaction.status === "PENDING" &&
      transaction.dueDate < now;

    if (!shouldBeOverdue) return transaction;
    changed = true;
    return { ...transaction, status: "OVERDUE" as const };
  });

  return changed ? next : transactions;
}

/** Sobreposicao de horario do MESMO profissional. */
export function findConflict(
  appointments: Appointment[],
  candidate: { id?: string; professionalId: string; startsAt: string; endsAt: string },
): Appointment | null {
  return (
    appointments.find(
      (appointment) =>
        appointment.id !== candidate.id &&
        appointment.professionalId === candidate.professionalId &&
        appointment.status !== "CANCELLED" &&
        appointment.startsAt < candidate.endsAt &&
        appointment.endsAt > candidate.startsAt,
    ) ?? null
  );
}
