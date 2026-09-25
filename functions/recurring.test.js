import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rotina diaria das mensalidades. O que se protege: o mes sai junto com o
 * marcador, nunca sobrescreve um mes existente, nao cobra documento fora da
 * propria organizacao e percorre todas as paginas.
 */
const mock = vi.hoisted(() => ({ pages: [], writes: [], commits: [], consultas: [] }));
vi.mock("firebase-admin/firestore", async () => {
  const { Timestamp } = await vi.importActual("firebase-admin/firestore");
  return {
    Timestamp,
    getFirestore: () => ({
      doc: (path) => ({ path }),
      collectionGroup: (name) => {
        const state = { name, filters: [], cursor: null };
        const query = {
          where: (field, op, value) => { state.filters.push([field, op, value]); return query; },
          limit: () => query,
          startAfter: (cursor) => { state.cursor = cursor; return query; },
          get: async () => {
            mock.consultas.push({ ...state });
            const docs = mock.pages.shift() ?? [];
            return { empty: docs.length === 0, docs };
          },
        };
        return query;
      },
      batch: () => {
        const writes = [];
        return {
          create: (ref, data) => writes.push({ op: "create", path: ref.path, data }),
          update: (ref, data) => writes.push({ op: "update", path: ref.path, data }),
          commit: async () => {
            const outcome = mock.commits.shift();
            if (outcome) throw outcome;
            mock.writes.push(...writes);
          },
        };
      },
    }),
  };
});
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/scheduler", () => ({ onSchedule: (options, handler) => Object.assign(handler, { options }) }));

import { launchRecurringCharges, launchRecurringChargesDaily } from "./recurring.js";
import { paths } from "./generated/paths.js";

const NOW = new Date("2026-10-01T06:15:00.000Z");

const charge = (id, extra = {}, org = "org-a") => ({
  id,
  ref: { path: paths.document(org, "recurringCharges", id), parent: { parent: { id: org } } },
  data: () => ({
    organizationId: "org-a",
    clientId: "c1",
    clientName: "Ana Ficticia",
    professionalId: null,
    description: "Mensalidade",
    amountInCents: 45000,
    method: "PIX",
    dueDay: 10,
    startPeriod: "2026-09",
    lastLaunchedPeriod: "2026-09",
    status: "ACTIVE",
    endedAt: null,
    ...extra,
  }),
});

beforeEach(() => {
  mock.pages = [];
  mock.writes = [];
  mock.commits = [];
  mock.consultas = [];
});

describe("rotina diaria de mensalidades", () => {
  it("lanca o mes novo com o marcador e a trilha no mesmo lote", async () => {
    mock.pages = [[charge("m1")]];
    const totals = await launchRecurringCharges(NOW);

    expect(totals).toEqual({ launched: 1, skipped: 0, existing: 0, failed: 0 });
    expect(mock.consultas[0].filters).toEqual([["status", "==", "ACTIVE"]]);
    const created = mock.writes.find((write) => write.path === paths.document("org-a", "transactions", "m1-202610"));
    expect(created).toMatchObject({ op: "create", data: { status: "PENDING", amountInCents: 45000, period: "2026-10", recurringChargeId: "m1" } });
    expect(mock.writes).toContainEqual(expect.objectContaining({ op: "update", path: paths.document("org-a", "recurringCharges", "m1"), data: expect.objectContaining({ lastLaunchedPeriod: "2026-10" }) }));
    expect(mock.writes).toContainEqual(expect.objectContaining({ op: "create", path: paths.document("org-a", "auditLogs", "m1-202610-lancamento") }));
  });

  it("nao relanca o mes ja marcado — mes apagado pelo profissional nao renasce", async () => {
    mock.pages = [[charge("m1", { lastLaunchedPeriod: "2026-10" })]];
    expect(await launchRecurringCharges(NOW)).toMatchObject({ launched: 0, skipped: 1 });
    expect(mock.writes).toEqual([]);
  });

  it("mes que ja existe faz o lote inteiro falhar: nada e sobrescrito", async () => {
    mock.pages = [[charge("m1"), charge("m2", { lastLaunchedPeriod: null })]];
    mock.commits = [Object.assign(new Error("existe"), { code: 6 })];
    const totals = await launchRecurringCharges(NOW);

    expect(totals).toMatchObject({ launched: 1, existing: 1, failed: 0 });
    expect(mock.writes.some((write) => write.path.includes("m1-202610"))).toBe(false);
    expect(mock.writes.some((write) => write.path.includes("m2-202610"))).toBe(true);
  });

  it("documento com organizacao diferente do caminho nao cobra ninguem", async () => {
    mock.pages = [[charge("m1", {}, "org-b")]];
    expect(await launchRecurringCharges(NOW)).toMatchObject({ launched: 0, failed: 1 });
    expect(mock.writes).toEqual([]);
  });

  it("percorre todas as paginas", async () => {
    mock.pages = [[charge("m1")], [charge("m2")]];
    expect(await launchRecurringCharges(NOW)).toMatchObject({ launched: 2 });
    expect(mock.consultas).toHaveLength(3);
    expect(mock.consultas[1].cursor?.id).toBe("m1");
  });

  it("roda todo dia em Sao Paulo, com a conta da automacao", () => {
    expect(launchRecurringChargesDaily.options).toMatchObject({ timeZone: "America/Sao_Paulo", schedule: "15 3 * * *", serviceAccount: expect.stringContaining("fn-automacao") });
  });

  it("o indice de collectionGroup existe: producao recusa a consulta sem ele", () => {
    const indexes = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
    const override = indexes.fieldOverrides.find((item) => item.collectionGroup === "recurringCharges" && item.fieldPath === "status");
    expect(override?.indexes).toContainEqual({ order: "ASCENDING", queryScope: "COLLECTION_GROUP" });
  });
});
