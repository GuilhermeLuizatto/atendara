import { describe, expect, it } from "vitest";

import { SERVICE_ERRORS, SERVICE_LIMITS } from "@/config/services";
import type { Service, ServiceInput } from "@/types";

import { appointmentDefaultsFor, bookableServices, nextServicePosition, validateService } from "./services";

function entrada(patch: Partial<ServiceInput> = {}): ServiceInput {
  return {
    name: "Design de sobrancelha",
    description: null,
    durationMinutes: 45,
    priceInCents: 7000,
    enabled: true,
    returnIntervalDays: null,
    ...patch,
  };
}

function servico(patch: Partial<Service> = {}): Service {
  return {
    id: "servico-1",
    organizationId: "org-1",
    createdAt: "2026-09-20T12:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-20T12:00:00.000Z",
    updatedBy: null,
    position: 0,
    archivedAt: null,
    ...entrada(),
    ...patch,
  };
}

describe("validacao do servico", () => {
  it("aceita o formulario completo e devolve o nome sem espaco sobrando", () => {
    const resultado = validateService(entrada({ name: "  Manicure  " }), { existing: [] });

    expect(resultado).toEqual({ ok: true, value: entrada({ name: "Manicure" }) });
  });

  it("nao liga servico sem preco nem sem duracao", () => {
    const semPreco = validateService(entrada({ priceInCents: null }), { existing: [] });
    const semDuracao = validateService(entrada({ durationMinutes: null }), { existing: [] });

    expect(semPreco).toEqual({ ok: false, error: SERVICE_ERRORS.ENABLED_NEEDS_PRICE_AND_DURATION });
    expect(semDuracao).toEqual({ ok: false, error: SERVICE_ERRORS.ENABLED_NEEDS_PRICE_AND_DURATION });
  });

  it("deixa o rascunho existir sem preco e sem duracao", () => {
    const resultado = validateService(
      entrada({ enabled: false, priceInCents: null, durationMinutes: null }),
      { existing: [] },
    );

    expect(resultado.ok).toBe(true);
  });

  // Duas linhas com o mesmo nome nao dizem qual e qual na hora de agendar.
  it("recusa nome repetido, ignorando maiuscula e espaco", () => {
    const resultado = validateService(entrada({ name: "manicure" }), {
      existing: [servico({ id: "outro", name: "Manicure " })],
    });

    expect(resultado).toEqual({ ok: false, error: SERVICE_ERRORS.DUPLICATE_NAME });
  });

  it("permite que o servico mantenha o proprio nome ao ser editado", () => {
    const resultado = validateService(entrada({ name: "Manicure" }), {
      existing: [servico({ id: "servico-1", name: "Manicure" })],
      editingId: "servico-1",
    });

    expect(resultado.ok).toBe(true);
  });

  it("recusa preco quebrado, duracao fora da faixa e retorno fora da faixa", () => {
    expect(validateService(entrada({ priceInCents: 70.5 }), { existing: [] })).toEqual({
      ok: false,
      error: SERVICE_ERRORS.PRICE_RANGE,
    });
    expect(validateService(entrada({ durationMinutes: 2 }), { existing: [] })).toEqual({
      ok: false,
      error: SERVICE_ERRORS.DURATION_RANGE,
    });
    expect(validateService(entrada({ returnIntervalDays: 400 }), { existing: [] })).toEqual({
      ok: false,
      error: SERVICE_ERRORS.RETURN_RANGE,
    });
  });

  it("para de aceitar servico novo no limite do catalogo, mas ainda deixa editar", () => {
    const existing = Array.from({ length: SERVICE_LIMITS.count }, (_, index) =>
      servico({ id: `servico-${index}`, name: `Servico ${index}`, position: index }),
    );

    expect(validateService(entrada({ name: "Mais um" }), { existing })).toEqual({
      ok: false,
      error: SERVICE_ERRORS.LIMIT_REACHED,
    });
    expect(validateService(entrada({ name: "Servico 0" }), { existing, editingId: "servico-0" }).ok).toBe(true);
  });
});

describe("catalogo na agenda", () => {
  it("oferece so o que esta ligado e nao arquivado, na ordem escolhida", () => {
    const lista = bookableServices([
      servico({ id: "c", name: "Cilios", position: 2 }),
      servico({ id: "a", name: "Manicure", position: 0 }),
      servico({ id: "rascunho", name: "Rascunho", position: 1, enabled: false }),
      servico({ id: "arquivado", name: "Antigo", position: 3, archivedAt: "2026-09-19T12:00:00.000Z" }),
    ]);

    expect(lista.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("preenche duracao e valor do atendimento, guardando o nome do servico", () => {
    expect(appointmentDefaultsFor(servico({ id: "s1", name: "Manicure", durationMinutes: 45, priceInCents: 7000 })))
      .toEqual({ serviceId: "s1", serviceName: "Manicure", durationMinutes: 45, priceInCents: 7000 });
  });

  it("sem servico escolhido, nao preenche nada", () => {
    expect(appointmentDefaultsFor(null)).toEqual({
      serviceId: null,
      serviceName: null,
      durationMinutes: null,
      priceInCents: null,
    });
  });

  it("a proxima posicao vai para o fim da lista", () => {
    expect(nextServicePosition([])).toBe(0);
    expect(nextServicePosition([servico({ position: 0 }), servico({ id: "b", position: 4 })])).toBe(5);
  });
});
