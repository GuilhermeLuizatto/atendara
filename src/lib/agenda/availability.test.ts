import { describe, expect, it } from "vitest";

import { availableSlots, firstAvailableSlots, isSlotFree, type AvailabilityInput } from "./availability";

/** Brasília: o expediente é lido neste fuso, e a resposta sai em UTC. */
const BRASILIA = -180;

/** Segunda-feira, 21/09/2026, 08:00 em Brasília = 11:00 UTC. */
const SEGUNDA_ABERTURA = "2026-09-21T11:00:00.000Z";

function entrada(patch: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    agenda: {
      workingDays: [1, 2, 3, 4, 5],
      workdayStart: "08:00",
      workdayEnd: "12:00",
      slotIntervalMinutes: 30,
    },
    durationMinutes: 50,
    bufferMinutes: 10,
    from: SEGUNDA_ABERTURA,
    to: "2026-09-21T15:00:00.000Z",
    busy: [],
    timezoneOffsetMinutes: BRASILIA,
    ...patch,
  };
}

describe("horarios livres", () => {
  it("anda de meia em meia hora e nao ultrapassa o fim do expediente", () => {
    const slots = availableSlots(entrada());

    expect(slots[0]).toEqual({ startsAt: "2026-09-21T11:00:00.000Z", endsAt: "2026-09-21T11:50:00.000Z" });
    // 11:00 (08:00 local) ate 14:10, porque um atendimento de 50 min tem de
    // caber inteiro num expediente que fecha as 12:00 locais (15:00 UTC).
    expect(slots.at(-1)).toEqual({ startsAt: "2026-09-21T14:00:00.000Z", endsAt: "2026-09-21T14:50:00.000Z" });
    expect(slots).toHaveLength(7);
  });

  it("atendimento que nao cabe inteiro no expediente nao e oferecido", () => {
    // 240 min cabem exatamente no expediente de 4 horas; 241 ja nao cabem.
    expect(availableSlots(entrada({ durationMinutes: 240 }))).toHaveLength(1);
    expect(availableSlots(entrada({ durationMinutes: 241 }))).toEqual([]);
  });

  it("respeita o intervalo entre atendimentos dos dois lados do ocupado", () => {
    const comOcupado = availableSlots(
      entrada({ busy: [{ startsAt: "2026-09-21T12:00:00.000Z", endsAt: "2026-09-21T12:50:00.000Z" }] }),
    );

    const inicios = comOcupado.map((slot) => slot.startsAt);
    // A folga de 10 minutos derruba tambem o horario que encostaria no ocupado.
    expect(inicios).not.toContain("2026-09-21T11:30:00.000Z");
    expect(inicios).not.toContain("2026-09-21T12:00:00.000Z");
    expect(inicios).not.toContain("2026-09-21T12:30:00.000Z");
    expect(inicios).toContain("2026-09-21T13:00:00.000Z");
  });

  it("bloco externo ocupa igual a atendimento — ocupado e ocupado, venha de onde vier", () => {
    const agendaPessoal = { startsAt: "2026-09-21T11:00:00.000Z", endsAt: "2026-09-21T13:00:00.000Z" };
    const slots = availableSlots(entrada({ busy: [agendaPessoal], bufferMinutes: 0 }));
    expect(slots.map((slot) => slot.startsAt)).toEqual([
      "2026-09-21T13:00:00.000Z",
      "2026-09-21T13:30:00.000Z",
      "2026-09-21T14:00:00.000Z",
    ]);
  });

  it("dia que nao e de atendimento nao oferece nada", () => {
    // Domingo, 20/09/2026.
    const domingo = availableSlots(
      entrada({ from: "2026-09-20T11:00:00.000Z", to: "2026-09-20T15:00:00.000Z" }),
    );
    expect(domingo).toEqual([]);
  });

  it("atravessa varios dias, pulando os que nao sao de atendimento", () => {
    const semana = availableSlots(
      entrada({ from: "2026-09-25T11:00:00.000Z", to: "2026-09-28T15:00:00.000Z", agenda: { ...entrada().agenda, slotIntervalMinutes: 60 } }),
    );
    const dias = [...new Set(semana.map((slot) => slot.startsAt.slice(0, 10)))];
    // Sexta e segunda; sabado e domingo ficam de fora.
    expect(dias).toEqual(["2026-09-25", "2026-09-28"]);
  });

  it("entrada sem sentido devolve lista vazia, em vez de horario invisivel", () => {
    expect(availableSlots(entrada({ durationMinutes: 0 }))).toEqual([]);
    expect(availableSlots(entrada({ to: SEGUNDA_ABERTURA }))).toEqual([]);
    expect(availableSlots(entrada({ from: "ontem" }))).toEqual([]);
    expect(availableSlots(entrada({ agenda: { ...entrada().agenda, slotIntervalMinutes: 0 } }))).toEqual([]);
  });

  it("a oferta pega so os primeiros", () => {
    expect(firstAvailableSlots(entrada(), 3)).toHaveLength(3);
    expect(firstAvailableSlots(entrada(), 0)).toEqual([]);
  });
});

describe("o horario ainda esta livre?", () => {
  const slot = { startsAt: "2026-09-21T13:00:00.000Z", endsAt: "2026-09-21T13:50:00.000Z" };

  it("livre quando nada encosta nele", () => {
    expect(isSlotFree(slot, [{ startsAt: "2026-09-21T14:00:00.000Z", endsAt: "2026-09-21T14:50:00.000Z" }], 0)).toBe(true);
  });

  it("ocupado quando alguem marcou no meio do caminho", () => {
    expect(isSlotFree(slot, [{ startsAt: "2026-09-21T13:30:00.000Z", endsAt: "2026-09-21T14:00:00.000Z" }], 0)).toBe(false);
  });

  it("o intervalo entre atendimentos tambem derruba o horario", () => {
    const encostado = [{ startsAt: "2026-09-21T13:50:00.000Z", endsAt: "2026-09-21T14:40:00.000Z" }];
    expect(isSlotFree(slot, encostado, 0)).toBe(true);
    expect(isSlotFree(slot, encostado, 10)).toBe(false);
  });
});
