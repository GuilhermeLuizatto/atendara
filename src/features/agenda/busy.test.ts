import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CalendarBusySnapshot } from "@/types/calendar";

import { BusyConflictNotice } from "./busy-conflict-notice";
import { layoutBusy } from "./layout";

// Horário do produto é -03:00: 14:00 local = 17:00Z.
const faixa = { startsAt: "2099-03-02T17:00:00.000Z", endsAt: "2099-03-02T18:30:00.000Z" };

describe("faixa de ocupado na grade do dia", () => {
  it("fica na altura certa e só no dia dela", () => {
    expect(layoutBusy([faixa], "2099-03-02", 8, 20, 60)).toEqual([
      { startsAt: faixa.startsAt, endsAt: faixa.endsAt, top: 6 * 60, height: 90 },
    ]);
    expect(layoutBusy([faixa], "2099-03-03", 8, 20, 60)).toEqual([]);
  });

  it("corta pela janela de horas e atravessa a meia-noite nos dois dias", () => {
    const noite = { startsAt: "2099-03-03T01:00:00.000Z", endsAt: "2099-03-03T05:00:00.000Z" }; // 22h–02h
    const antes = layoutBusy([noite], "2099-03-02", 0, 24, 60);
    expect(antes).toHaveLength(1);
    expect(antes[0]).toMatchObject({ top: 22 * 60, height: 2 * 60 });
    const depois = layoutBusy([noite], "2099-03-03", 0, 24, 60);
    expect(depois[0]).toMatchObject({ top: 0, height: 2 * 60 });
    // Fora da janela visível, nada.
    expect(layoutBusy([noite], "2099-03-03", 8, 20, 60)).toEqual([]);
  });
});

describe("aviso de compromisso no Google", () => {
  const leitura = (readAt: string): CalendarBusySnapshot => ({
    id: "prof-1",
    organizationId: "org",
    professionalId: "prof-1",
    generation: "g",
    blocks: [faixa],
    timeMin: readAt,
    timeMax: "2099-04-01T00:00:00.000Z",
    readAt,
  });
  const render = (snapshots: CalendarBusySnapshot[], time = "14:30") =>
    renderToStaticMarkup(
      createElement(BusyConflictNotice, {
        professionalId: "prof-1",
        professionalName: "Sam Fictício",
        date: "2099-03-02",
        time,
        durationMinutes: "60",
        snapshots,
      }),
    );
  // `useNow` usa o relógio real: leitura "de agora" é a que vale.
  const agora = new Date().toISOString();

  it("cruzando uma faixa recente, avisa e deixa marcar", () => {
    const html = render([{ ...leitura(agora), timeMin: agora }]);
    expect(html).toContain("cruza um compromisso no Google de Sam Fictício");
    expect(html).toContain("Você pode marcar mesmo assim");
  });

  it("horário livre não mostra nada; sem conexão também não", () => {
    expect(render([leitura(agora)], "16:00")).toBe("");
    expect(render([])).toBe("");
  });

  it("leitura velha diz que não dá para conferir, sem afirmar que está livre", () => {
    const html = render([leitura("2000-01-01T00:00:00.000Z")]);
    expect(html).toContain("está desatualizada");
    expect(html).not.toContain("cruza");
  });
});
