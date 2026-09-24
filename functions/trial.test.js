import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rotina que encerra o teste.
 *
 * O que estes testes protegem e a fronteira da regra 10: encerrar NAO e
 * escrever validade. A rotina so marca o inicio da retencao e registra o ato;
 * quem fecha o painel e a data, nas regras e na interface.
 */
const mock = vi.hoisted(() => ({ contas: [], writes: [], commit: vi.fn(), consulta: [], documentos: new Map(), apagar: vi.fn() }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({
  doc: path => ({ path, get: async () => ({ data: () => mock.documentos.get(path) }) }),
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
// O apagamento de verdade tem suite propria (`privacy-rights.access-test.ts`,
// que varre o que sobrou atras dos nomes originais). Aqui o que se prova e QUEM
// a rotina escolhe — e, acima de tudo, quem ela nao escolhe.
vi.mock("./privacy.js", () => ({ eraseOrganization: (...args) => mock.apagar(...args) }));
vi.mock("firebase-functions/v2/scheduler", () => ({ onSchedule: (options, handler) => Object.assign(handler, { options }) }));
vi.mock("firebase-functions/v2/https", () => ({ onCall: (options, handler) => Object.assign(handler, { options }), HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }));

import { closeExpiredTrials, closeExpiredTrialsDaily, eraseAbandonedTrials, eraseAbandonedTrialsDaily } from "./trial.js";
import { paths } from "./generated/paths.js";
import { BLOCKED_RETENTION_DAYS, SELF_SERVICE_ACTOR } from "./generated/platform-config.js";

const NOW = Date.parse("2026-10-01T07:00:00.000Z");
const conta = (userId, extra = {}) => ({
  id: userId,
  ref: { path: paths.account(userId) },
  data: () => ({ userId, organizationId: `org-${userId}`, accessUntil: "2026-09-30T12:00:00.000Z", ...extra }),
});
const auditWrites = () => mock.writes.filter(write => write.path.startsWith("platformAuditLogs/"));

/**
 * O emulador responde sem indice composto; producao recusa com
 * FAILED_PRECONDITION. Foi assim que `eraseAbandonedTrialsDaily` falhou todo
 * dia de 18 a 24/09/2026 com todos os testes verdes.
 *
 * Reproduz a exigencia do Firestore para igualdades seguidas de UM campo em
 * intervalo, sem `orderBy`: as igualdades primeiro, em qualquer ordem, depois o
 * campo do intervalo, tudo crescente e nada a mais — um indice com campos
 * sobrando depois do intervalo nao serve, e era esse o engano.
 */
const INDICES = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8")).indexes;
function indiceDeclarado(consulta) {
  const colecao = consulta[0].path.split("/").pop();
  const igualdades = new Set(consulta.filter(filtro => filtro.op === "==").map(filtro => filtro.field));
  const intervalos = new Set(consulta.filter(filtro => filtro.op !== "==").map(filtro => filtro.field));
  expect(intervalos.size).toBe(1);
  const [intervalo] = intervalos;
  return INDICES.some(indice => {
    if (indice.collectionGroup !== colecao || indice.queryScope !== "COLLECTION") return false;
    if (indice.fields.length !== igualdades.size + 1) return false;
    if (indice.fields.some(campo => campo.order !== "ASCENDING")) return false;
    const prefixo = indice.fields.slice(0, -1).map(campo => campo.fieldPath);
    return prefixo.every(campo => igualdades.has(campo)) && indice.fields.at(-1).fieldPath === intervalo;
  });
}

beforeEach(() => {
  vi.clearAllMocks(); mock.contas = []; mock.writes = []; mock.consulta = []; mock.documentos.clear();
  mock.commit.mockResolvedValue(undefined); mock.apagar.mockResolvedValue({ requestId: "pedido", counts: {} });
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
      // Quem ja pagou saiu do ciclo do teste (A.6).
      { path: paths.accounts(), field: "subscribedAt", op: "==", value: null },
      // `> 0` tira quem nunca confirmou o e-mail: sem concessao, nao ha teste a encerrar.
      { path: paths.accounts(), field: "accessUntilMs", op: ">", value: 0 },
      { path: paths.accounts(), field: "accessUntilMs", op: "<=", value: NOW },
    ]);
  });

  it("tem indice composto declarado para a consulta", async () => {
    await closeExpiredTrials(NOW);
    expect(indiceDeclarado(mock.consulta)).toBe(true);
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

describe("Apagamento do cadastro abandonado", () => {
  const DIA = 86_400_000;
  const abandonada = (userId, extra = {}) => {
    const conta = {
      id: userId,
      ref: { path: paths.account(userId) },
      data: () => ({ userId, organizationId: `org-${userId}`, origin: "SELF_SERVICE", ...extra }),
    };
    mock.documentos.set(paths.organization(`org-${userId}`), { id: `org-${userId}`, ownerId: userId });
    return conta;
  };

  it("procura so quem ja foi bloqueada e ja cumpriu o prazo inteiro", async () => {
    await eraseAbandonedTrials(NOW);
    const limite = new Date(NOW - BLOCKED_RETENTION_DAYS * DIA).toISOString();
    expect(mock.consulta).toEqual([
      { path: paths.accounts(), field: "origin", op: "==", value: "SELF_SERVICE" },
      // Sem esta, `null` entraria: no Firestore ele vem antes de qualquer texto.
      { path: paths.accounts(), field: "blockedSince", op: ">=", value: "" },
      { path: paths.accounts(), field: "blockedSince", op: "<=", value: limite },
    ]);
    expect(mock.apagar).not.toHaveBeenCalled();
  });

  it("tem indice composto declarado para a consulta", async () => {
    await eraseAbandonedTrials(NOW);
    expect(indiceDeclarado(mock.consulta)).toBe(true);
  });

  it("apaga pelo mesmo caminho do titular, com a conta dele saindo por ultimo", async () => {
    mock.contas = [abandonada("bianca")];
    expect(await eraseAbandonedTrials(NOW)).toEqual({ erased: 1 });
    expect(mock.apagar).toHaveBeenCalledTimes(1);
    expect(mock.apagar.mock.calls[0][0]).toMatchObject({
      organizationId: "org-bianca",
      actorId: SELF_SERVICE_ACTOR,
      action: "ABANDONED_ORGANIZATION_ERASED",
      lastAccountUserId: "bianca",
    });
  });

  it("nao apaga quem voltou a pagar, nem o que ja foi apagado", async () => {
    mock.contas = [abandonada("pagante"), abandonada("ja-apagada"), abandonada("sem-org", { organizationId: null })];
    mock.documentos.set(paths.platformSubscription("org-pagante"), { status: "ACTIVE" });
    mock.documentos.set(paths.organization("org-ja-apagada"), { id: "org-ja-apagada", deletion: { status: "DONE" } });

    expect(await eraseAbandonedTrials(NOW)).toEqual({ erased: 0 });
    expect(mock.apagar).not.toHaveBeenCalled();
  });

  it("nunca apaga quem ja pagou alguma vez (A.6)", async () => {
    mock.contas = [abandonada("ex-assinante", { subscribedAt: "2026-06-01T10:00:00.000Z" })];
    expect(await eraseAbandonedTrials(NOW)).toEqual({ erased: 0 });
    expect(mock.apagar).not.toHaveBeenCalled();
  });

  it("uma falha nao impede as outras", async () => {
    mock.contas = [abandonada("quebra"), abandonada("segue")];
    mock.apagar.mockRejectedValueOnce(new Error("indisponivel"));
    expect(await eraseAbandonedTrials(NOW)).toEqual({ erased: 1 });
    expect(mock.apagar).toHaveBeenCalledTimes(2);
  });

  it("roda depois da rotina que encerra, com tempo para varrer", () => {
    expect(eraseAbandonedTrialsDaily.options).toMatchObject({
      region: "southamerica-east1",
      schedule: "30 4 * * *",
      timeZone: "America/Sao_Paulo",
      timeoutSeconds: 540,
    });
  });
});
