import { describe, expect, it } from "vitest";

import { CALENDAR_BUSY_STALE_MINUTES, CALENDAR_CLOCK_SKEW_MINUTES, GOOGLE_CALENDAR_SCOPES } from "@/config/calendar";
import type { Appointment } from "@/types";

import { busyConflicts, calendarEventFor, decideCalendarSync, isBusySnapshotFresh, parseBusyBlocks, parsePrimaryBusy } from "./calendar";

const ATENDIMENTO: Pick<Appointment, "startsAt" | "endsAt" | "clientName" | "status"> = {
  startsAt: "2026-09-25T13:00:00.000Z",
  endsAt: "2026-09-25T13:50:00.000Z",
  clientName: "Alex Fictício",
  status: "SCHEDULED",
};

describe("o que o evento pode dizer", () => {
  it("no grau mais fechado, nao tem nome de pessoa nem tipo de atendimento", () => {
    const evento = calendarEventFor({ appointment: ATENDIMENTO, serviceTerm: "consulta", disclosure: "TIME_ONLY" });

    expect(evento.summary).toBe("Atendimento");
    expect(evento.summary).not.toContain("Alex");
    expect(evento.summary).not.toContain("consulta");
  });

  it("com profissional, entra o nome de quem e atendido; com servico, entra tambem o tipo", () => {
    expect(
      calendarEventFor({ appointment: ATENDIMENTO, serviceTerm: "consulta", disclosure: "TIME_AND_PROFESSIONAL" }).summary,
    ).toBe("Alex Fictício");
    expect(
      calendarEventFor({
        appointment: ATENDIMENTO,
        serviceTerm: "consulta",
        disclosure: "TIME_PROFESSIONAL_AND_SERVICE",
      }).summary,
    ).toBe("consulta — Alex Fictício");
  });

  it("a descricao vai sempre vazia — e onde texto pessoal vaza sem ninguem perceber", () => {
    for (const disclosure of ["TIME_ONLY", "TIME_AND_PROFESSIONAL", "TIME_PROFESSIONAL_AND_SERVICE"] as const) {
      expect(calendarEventFor({ appointment: ATENDIMENTO, serviceTerm: "consulta", disclosure }).description).toBeNull();
    }
  });

  it("pede livre/ocupado e escrita só na agenda criada pelo Atendara", () => {
    expect(GOOGLE_CALENDAR_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/calendar.app.created",
    ]);
    // Pedir `calendar` inteiro seria pedir a agenda pessoal de quem atende.
    expect(GOOGLE_CALENDAR_SCOPES).not.toContain("https://www.googleapis.com/auth/calendar");
  });
});

describe("o que fazer no Google depois de uma mudanca", () => {
  it("atendimento novo cria evento; sem mudanca, nao faz nada", () => {
    expect(decideCalendarSync({ before: null, after: ATENDIMENTO, externalEventId: null })).toBe("CREATE");
    expect(decideCalendarSync({ before: ATENDIMENTO, after: ATENDIMENTO, externalEventId: "evt-1" })).toBe("NONE");
  });

  it("remarcado muda o evento", () => {
    const depois = { ...ATENDIMENTO, startsAt: "2026-09-26T13:00:00.000Z", endsAt: "2026-09-26T13:50:00.000Z" };
    expect(decideCalendarSync({ before: ATENDIMENTO, after: depois, externalEventId: "evt-1" })).toBe("UPDATE");
  });

  it("cancelado ou falta some da agenda", () => {
    for (const status of ["CANCELLED", "NO_SHOW"] as const) {
      expect(decideCalendarSync({ before: ATENDIMENTO, after: { ...ATENDIMENTO, status }, externalEventId: "evt-1" })).toBe(
        "DELETE",
      );
    }
  });

  it("atendimento apagado sem evento no Google nao tenta apagar nada", () => {
    expect(decideCalendarSync({ before: ATENDIMENTO, after: null, externalEventId: null })).toBe("NONE");
    expect(decideCalendarSync({ before: ATENDIMENTO, after: null, externalEventId: "evt-1" })).toBe("DELETE");
  });
});

describe("o que volta do Google", () => {
  const resposta = {
    kind: "calendar#freeBusy",
    calendars: {
      primary: {
        busy: [
          { start: "2026-09-25T12:00:00Z", end: "2026-09-25T13:00:00Z" },
          // Campos a mais na resposta: nao sao lidos.
          { start: "2026-09-25T15:00:00Z", end: "2026-09-25T16:00:00Z", summary: "Dentista", attendees: ["alguem@exemplo.com"] },
        ],
      },
    },
  };

  it("le so faixa de tempo — titulo e convidado nao passam por aqui", () => {
    const blocos = parseBusyBlocks(resposta);

    expect(blocos).toEqual([
      { startsAt: "2026-09-25T12:00:00.000Z", endsAt: "2026-09-25T13:00:00.000Z" },
      { startsAt: "2026-09-25T15:00:00.000Z", endsAt: "2026-09-25T16:00:00.000Z" },
    ]);
    expect(JSON.stringify(blocos)).not.toContain("Dentista");
    expect(JSON.stringify(blocos)).not.toContain("exemplo.com");
  });

  it("descarta bloco sem sentido, em vez de gravar lixo", () => {
    expect(
      parseBusyBlocks({ calendars: { primary: { busy: [{ start: "ontem", end: "hoje" }, { start: "2026-09-25T15:00:00Z" }] } } }),
    ).toEqual([]);
    expect(parseBusyBlocks({ calendars: { primary: { busy: "nada" } } })).toEqual([]);
    expect(parseBusyBlocks({})).toEqual([]);
    expect(parseBusyBlocks(null)).toEqual([]);
  });

  it("devolve em ordem, mesmo que o Google mande fora de ordem", () => {
    const fora = { calendars: { a: { busy: [{ start: "2026-09-25T18:00:00Z", end: "2026-09-25T19:00:00Z" }] }, b: { busy: [{ start: "2026-09-25T08:00:00Z", end: "2026-09-25T09:00:00Z" }] } } };
    expect(parseBusyBlocks(fora).map((bloco) => bloco.startsAt)).toEqual([
      "2026-09-25T08:00:00.000Z",
      "2026-09-25T18:00:00.000Z",
    ]);
  });
});

describe("o ocupado lido ainda serve?", () => {
  const agora = "2026-09-25T12:00:00.000Z";

  it("leitura recente vale; leitura velha nao segura oferta", () => {
    const recente = new Date(Date.parse(agora) - (CALENDAR_BUSY_STALE_MINUTES - 5) * 60_000).toISOString();
    const velha = new Date(Date.parse(agora) - (CALENDAR_BUSY_STALE_MINUTES + 5) * 60_000).toISOString();

    expect(isBusySnapshotFresh(recente, agora)).toBe(true);
    expect(isBusySnapshotFresh(velha, agora)).toBe(false);
    expect(isBusySnapshotFresh(null, agora)).toBe(false);
    expect(isBusySnapshotFresh("2026-09-26T12:00:00Z", agora)).toBe(false);
    expect(isBusySnapshotFresh("inválida", agora)).toBe(false);
  });

  it("leitura segundos à frente do relógio da tela vale; muito à frente, não", () => {
    const logoAposOTique = new Date(Date.parse(agora) + 40_000).toISOString();
    const muitoAFrente = new Date(Date.parse(agora) + (CALENDAR_CLOCK_SKEW_MINUTES + 1) * 60_000).toISOString();

    expect(isBusySnapshotFresh(logoAposOTique, agora)).toBe(true);
    expect(isBusySnapshotFresh(muitoAFrente, agora)).toBe(false);
  });
});

describe("consulta completa da agenda principal", () => {
  it("distingue agenda vazia de resposta ausente ou com erro parcial", () => {
    expect(parsePrimaryBusy({ calendars: { primary: { busy: [] } } })).toEqual([]);
    for (const value of [null, {}, { calendars: {} }, { calendars: { primary: { busy: [], errors: [{ reason: "notFound" }] } } }]) {
      expect(parsePrimaryBusy(value)).toBeNull();
    }
  });
  it("um único intervalo inválido invalida toda a leitura", () => {
    expect(parsePrimaryBusy({ calendars: { primary: { busy: [
      { start: "2026-09-25T12:00:00Z", end: "2026-09-25T13:00:00Z" },
      { start: "inválido", end: "inválido" },
    ] } } })).toBeNull();
  });
});

describe("o horário cruza um compromisso do Google?", () => {
  const agora = "2026-09-25T12:00:00.000Z";
  const leitura = {
    professionalId: "prof-1",
    readAt: agora,
    timeMin: agora,
    timeMax: "2026-10-25T12:00:00.000Z",
    blocks: [{ startsAt: "2026-09-26T14:00:00.000Z", endsAt: "2026-09-26T15:00:00.000Z" }],
  };
  const checar = (startsAt: string, endsAt: string, overrides = {}) =>
    busyConflicts({ startsAt, endsAt, professionalId: "prof-1", snapshots: [{ ...leitura, ...overrides }], now: agora });

  it("leitura recente: cruza quem encosta por dentro, não quem só toca a borda", () => {
    expect(checar("2026-09-26T14:30:00.000Z", "2026-09-26T15:30:00.000Z")).toEqual({
      status: "FRESH",
      conflicts: leitura.blocks,
    });
    expect(checar("2026-09-26T15:00:00.000Z", "2026-09-26T16:00:00.000Z")).toEqual({ status: "FRESH", conflicts: [] });
  });

  it("sem leitura, leitura velha ou fora do período não afirmam agenda livre", () => {
    expect(
      busyConflicts({ startsAt: agora, endsAt: agora, professionalId: "outro", snapshots: [leitura], now: agora }).status,
    ).toBe("ABSENT");
    expect(checar("2026-09-26T16:00:00.000Z", "2026-09-26T17:00:00.000Z", { readAt: "2026-09-20T12:00:00.000Z" }).status).toBe("STALE");
    expect(checar("2026-11-26T16:00:00.000Z", "2026-11-26T17:00:00.000Z").status).toBe("STALE");
  });
});
