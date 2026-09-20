import { SERVICE_ERRORS } from "@/config/services";
import { nextServicePosition, validateService } from "@/lib/agenda/services";
import type { ID, Service } from "@/types";

import { assertPermission } from "../../guards";
import { RepositoryError, type ServiceInput } from "../../types";
import { auditWrite, docPath, stamp, touch, type Plan, type PlanContext } from "../plan";

/**
 * Catálogo de serviços (Estética, E2.1).
 *
 * Preço e duração são sempre da profissional — o Atendara não sugere valor.
 * A validação é a mesma de `lib/agenda/services.ts`, usada também pela
 * implementação em memória: duas respostas diferentes para o mesmo formulário
 * seria uma regra por implementação.
 */

function requireService(ctx: PlanContext, id: ID): Service {
  const service = ctx.snapshot.services.find((item) => item.id === id);
  if (!service) throw new RepositoryError("Serviço não encontrado.");
  return service;
}

function validate(ctx: PlanContext, input: ServiceInput, editingId: ID | null): ServiceInput {
  const validation = validateService(input, { existing: ctx.snapshot.services, editingId });
  if (!validation.ok) throw new RepositoryError(validation.error);
  return validation.value;
}

export function planCreateService(ctx: PlanContext, raw: ServiceInput): Plan<ID> {
  assertPermission(ctx.actor, "service:manage");
  const input = validate(ctx, raw, null);

  const id = ctx.newId("services");
  const service: Service = {
    id,
    organizationId: ctx.organizationId,
    ...stamp(ctx),
    ...input,
    position: nextServicePosition(ctx.snapshot.services),
    archivedAt: null,
  };

  return {
    result: id,
    writes: [
      { op: "set", collection: "services", path: docPath(ctx, "services", id), data: service as unknown as Record<string, unknown> },
      auditWrite(ctx, {
        action: "CREATE",
        actorType: "USER",
        resource: { type: "service", id },
        summary: `Serviço "${service.name}" criado.`,
        // O valor entra na trilha: mudança de preço é o que mais gera dúvida
        // depois, e a trilha precisa responder "quanto era antes".
        metadata: { priceInCents: service.priceInCents, durationMinutes: service.durationMinutes, enabled: service.enabled },
      }),
    ],
  };
}

export function planUpdateService(ctx: PlanContext, id: ID, patch: Partial<ServiceInput>): Plan {
  assertPermission(ctx.actor, "service:manage");
  const existing = requireService(ctx, id);
  if (existing.archivedAt) throw new RepositoryError("Serviço arquivado não pode ser alterado.");

  const input = validate(ctx, { ...existing, ...patch }, id);
  const updated: Service = { ...existing, ...input, ...touch(ctx) };

  return {
    result: undefined,
    writes: [
      { op: "set", collection: "services", path: docPath(ctx, "services", id), data: updated as unknown as Record<string, unknown> },
      auditWrite(ctx, {
        action: "UPDATE",
        actorType: "USER",
        resource: { type: "service", id },
        summary: `Serviço "${updated.name}" alterado.`,
        metadata: {
          priceInCents: updated.priceInCents,
          previousPriceInCents: existing.priceInCents,
          durationMinutes: updated.durationMinutes,
          enabled: updated.enabled,
        },
      }),
    ],
  };
}

/**
 * Arquivar em vez de apagar. Atendimento passado guarda o id do serviço, e
 * apagar deixaria um registro apontando para o nada.
 */
export function planArchiveService(ctx: PlanContext, id: ID): Plan {
  assertPermission(ctx.actor, "service:manage");
  const existing = requireService(ctx, id);
  const archived: Service = { ...existing, enabled: false, archivedAt: ctx.now, ...touch(ctx) };

  return {
    result: undefined,
    writes: [
      { op: "set", collection: "services", path: docPath(ctx, "services", id), data: archived as unknown as Record<string, unknown> },
      auditWrite(ctx, {
        action: "UPDATE",
        actorType: "USER",
        resource: { type: "service", id },
        summary: `Serviço "${existing.name}" arquivado.`,
        metadata: { archived: true },
      }),
    ],
  };
}

/** Apagar de vez só o que nunca foi usado — o resto se arquiva. */
export function planDeleteService(ctx: PlanContext, id: ID): Plan {
  assertPermission(ctx.actor, "service:manage");
  const existing = requireService(ctx, id);
  const usado = ctx.snapshot.appointments.some((appointment) => appointment.serviceId === id);
  if (usado) {
    throw new RepositoryError(
      "Este serviço já foi usado em um atendimento. Arquive em vez de apagar, para o histórico continuar legível.",
    );
  }

  return {
    result: undefined,
    writes: [
      { op: "delete", path: docPath(ctx, "services", id) },
      auditWrite(ctx, {
        action: "DELETE",
        actorType: "USER",
        resource: { type: "service", id },
        summary: `Serviço "${existing.name}" apagado.`,
        metadata: { name: existing.name },
      }),
    ],
  };
}

export { SERVICE_ERRORS };
