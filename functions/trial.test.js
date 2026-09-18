import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rotina que encerra o teste.
 *
 * O que estes testes protegem e a fronteira da regra 10: encerrar NAO e
 * escrever validade. A rotina so marca o inicio da retencao e registra o ato;
 * quem fecha o painel e a data, nas regras e na interface.
 */
const mock = vi.hoisted(() => ({ contas: [], writes: [], commit: vi.fn(), consulta: [] }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({
  doc: path => ({ path }),
  collection: path => {
    const query = {
      where: (field, op, value) => { mock.consulta.push({ path, field, op, value }); return query; },
      limit: () => query,
      get: async () => ({ empty: mock.contas.length === 0, size: mock.contas.length, docs: mock.contas }),
    };
    return query;
  },
  batch: () => ({
    update: (ref, data) => mock.writes.push({ op: "update", path: ref.path, data }),
    create: (ref, data) => mock.writes.push({ op: "create", path: ref.path, data }),
    commit: mock.commit,
  }),
}) }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/v2/scheduler", () => ({ onSchedule: (options, handler) => Object.assign(handler, { options }) }));
vi.mock("firebase-functions/v2/https", () => ({ onCall: (options, handler) => Object.assign(handler, { options }), HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }));

import { closeExpiredTrials, closeExpiredTrialsDaily } from "./trial.js";
import { paths } from "./generated/paths.js";
import { SELF_SERVICE_ACTOR } from "./generated/platform-config.js";

const NOW = Date.parse("2026-10-01T07:00:00.000Z");
const conta = (userId, extra = {}) => ({
  id: userId,
  ref: { path: paths.account(userId) },
  data: () => ({ userId, organizationId: `org-${userId}`, accessUntil: "2026-09-30T12:00:00.000Z", ...extra }),
});
const auditWrites = () => mock.writes.filter(write => write.path.startsWith("platformAuditLogs/"));

beforeEach(() => {
  vi.clearAllMocks(); mock.contas = []; mock.writes = []; mock.consulta = []; mock.commit.mockResolvedValue(undefined);
});

describe("Fim do teste de 14 dias", () => {
  it("nao escreve nada quando nao ha vencidas", async () => {
    expect(await closeExpiredTrials(NOW)).toEqual({ closed: 0 });
    expect(mock.writes).toHaveLength(0);
    expect(mock.commit).not.toHaveBeenCalled();
  });

  it("procura so cadastro aberto, ainda nao marcado e com validade ja vencida", async () => {
    await closeExpiredTrials(NOW);
    expect(mock.consulta).toEqual([
      { path: paths.accounts(), field: "origin", op: "==", value: "SELF_SERVICE" },
      { path: paths.accounts(), field: "blockedSince", op: "==", value: null },
      // `> 0` tira quem nunca confirmou o e-mail: sem concessao, nao ha teste a encerrar.
      { path: paths.accounts(), field: "accessUntilMs", op: ">", value: 0 },
      { path: paths.accounts(), field: "accessUntilMs", op: "<=", value: NOW },
    ]);
  });

  it("marca o inicio da retencao e registra, sem tocar na validade", async () => {
    mock.contas = [conta("bianca"), conta("helena")];
    expect(await closeExpiredTrials(NOW)).toEqual({ closed: 2 });

    const marcas = mock.writes.filter(write => write.path.startsWith("accounts/"));
    expect(marcas).toHaveLength(2);
    for (const marca of marcas) {
      // Regra 10: a rotina nao e um quarto caminho de validade.
      expect(Object.keys(marca.data)).toEqual(["blockedSince"]);
      expect(marca.data.blockedSince).toBe(new Date(NOW).toISOString());
    }

    expect(auditWrites()).toHaveLength(2);
    expect(auditWrites()[0].data).toMatchObject({
      action: "TRIAL_ENDED",
      actorId: SELF_SERVICE_ACTOR,
      organizationId: "org-bianca",
      targetUserId: "bianca",
      details: { expiredAt: "2026-09-30T12:00:00.000Z" },
    });
    // Marca e registro no MESMO lote: nao existe bloqueio sem trilha.
    expect(mock.commit).toHaveBeenCalledTimes(1);
  });

  it("roda uma vez por dia, de madrugada, na regiao do projeto", () => {
    expect(closeExpiredTrialsDaily.options).toMatchObject({
      region: "southamerica-east1",
      schedule: "0 4 * * *",
      timeZone: "America/Sao_Paulo",
      maxInstances: 1,
    });
  });
});
