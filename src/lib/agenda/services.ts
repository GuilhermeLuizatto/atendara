import { SERVICE_ERRORS, SERVICE_LIMITS } from "@/config/services";
import type { Service, ServiceInput } from "@/types";

/**
 * Regras do catálogo de serviços (E2.1), sem I/O.
 *
 * A validação vive aqui, e não na tela, porque as duas implementações do
 * repositório — memória e Firestore — precisam da mesma resposta. Tela que
 * valida sozinha vira duas verdades sobre o mesmo campo.
 */

export type ServiceValidation = { ok: true; value: ServiceInput } | { ok: false; error: string };

function limpar(texto: string | null): string | null {
  const valor = texto?.trim() ?? "";
  return valor.length > 0 ? valor : null;
}

export function validateService(
  input: ServiceInput,
  context: { existing: readonly Pick<Service, "id" | "name">[]; editingId?: string | null },
): ServiceValidation {
  const name = input.name.trim();
  if (name.length < SERVICE_LIMITS.name.min) return { ok: false, error: SERVICE_ERRORS.NAME_REQUIRED };
  if (name.length > SERVICE_LIMITS.name.max) return { ok: false, error: SERVICE_ERRORS.NAME_TOO_LONG };

  // Nome repetido confunde na hora de marcar: a lista do atendimento mostra só
  // o nome, e duas linhas iguais não dizem qual é qual.
  const repetido = context.existing.some(
    (servico) => servico.id !== context.editingId && servico.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (repetido) return { ok: false, error: SERVICE_ERRORS.DUPLICATE_NAME };

  if (!context.editingId && context.existing.length >= SERVICE_LIMITS.count) {
    return { ok: false, error: SERVICE_ERRORS.LIMIT_REACHED };
  }

  const { durationMinutes, priceInCents, returnIntervalDays } = input;
  if (
    durationMinutes !== null &&
    (!Number.isInteger(durationMinutes) ||
      durationMinutes < SERVICE_LIMITS.durationMinutes.min ||
      durationMinutes > SERVICE_LIMITS.durationMinutes.max)
  ) {
    return { ok: false, error: SERVICE_ERRORS.DURATION_RANGE };
  }
  if (
    priceInCents !== null &&
    (!Number.isInteger(priceInCents) ||
      priceInCents < SERVICE_LIMITS.priceInCents.min ||
      priceInCents > SERVICE_LIMITS.priceInCents.max)
  ) {
    return { ok: false, error: SERVICE_ERRORS.PRICE_RANGE };
  }
  if (
    returnIntervalDays !== null &&
    (!Number.isInteger(returnIntervalDays) ||
      returnIntervalDays < SERVICE_LIMITS.returnIntervalDays.min ||
      returnIntervalDays > SERVICE_LIMITS.returnIntervalDays.max)
  ) {
    return { ok: false, error: SERVICE_ERRORS.RETURN_RANGE };
  }

  // Decisão do titular (20/09): ligado significa pronto para usar.
  if (input.enabled && (durationMinutes === null || priceInCents === null)) {
    return { ok: false, error: SERVICE_ERRORS.ENABLED_NEEDS_PRICE_AND_DURATION };
  }

  return {
    ok: true,
    value: { ...input, name, description: limpar(input.description), durationMinutes, priceInCents, returnIntervalDays },
  };
}

/** O que a agenda oferece: ligado, não arquivado, na ordem escolhida por ela. */
export function bookableServices(services: readonly Service[]): Service[] {
  return services
    .filter((servico) => servico.enabled && servico.archivedAt === null)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * O que escolher um serviço preenche no atendimento.
 *
 * Preenche, **não trava**: a profissional muda o valor e a duração naquele
 * atendimento sem mexer no catálogo — cliente antiga, área maior, combinado
 * diferente. O catálogo é ponto de partida, não tabela imposta.
 */
export function appointmentDefaultsFor(service: Service | null): {
  serviceId: string | null;
  serviceName: string | null;
  durationMinutes: number | null;
  priceInCents: number | null;
} {
  if (!service) return { serviceId: null, serviceName: null, durationMinutes: null, priceInCents: null };
  return {
    serviceId: service.id,
    // O nome vai junto porque o atendimento é registro do que aconteceu:
    // renomear o serviço depois não pode reescrever o passado.
    serviceName: service.name,
    durationMinutes: service.durationMinutes,
    priceInCents: service.priceInCents,
  };
}

/** Próxima posição livre na lista. */
export function nextServicePosition(services: readonly Service[]): number {
  return services.reduce((maior, servico) => Math.max(maior, servico.position), -1) + 1;
}
