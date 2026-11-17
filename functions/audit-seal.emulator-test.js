import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CHAIN_DOCUMENT_ID, handleAuditLogCreated } from "./audit-seal.js";
import { verifyAuditSealChain } from "./audit-seal-chain.js";
import { fromStored, toStored } from "./firestore-dates.js";
import { paths } from "./generated/paths.js";

/**
 * Selo da trilha contra o emulador do Firestore.
 *
 * O que so um banco de verdade prova: a transacao que da o indice, o horario de
 * escrita do servidor (`createTime`), a reentrega do mesmo evento e duas
 * entradas que chegam juntas. O calculo da corrente esta coberto em
 * `audit-seal-chain.test.js`.
 *
 * Rodar com: npm run test:repository
 */

const ORG = `org-selo-${Date.now()}`;
const AT = "2026-11-17T12:00:00.000Z";

let app;
let db;

const logRef = (id) => db.doc(paths.document(ORG, "auditLogs", id));
const sealRef = (id) => db.doc(paths.document(ORG, "auditSeals", id));
const chainRef = () => db.doc(paths.document(ORG, "auditSealChains", CHAIN_DOCUMENT_ID));

function entry(id, patch = {}) {
  return {
    id,
    organizationId: ORG,
    actorType: "USER",
    actorId: "membro-1",
    actorName: "Quem registrou",
    action: "CREATE",
    summary: "Cadastro fictício criado.",
    resource: { type: "client", id: "cliente-1" },
    metadata: { module: "clientes" },
    occurredAt: AT,
    createdAt: AT,
    updatedAt: AT,
    createdBy: "membro-1",
    updatedBy: "membro-1",
    ...patch,
  };
}

/** Grava a entrada e devolve o evento que o gatilho receberia por ela. */
async function writeLog(id, patch = {}) {
  const ref = logRef(id);
  await ref.set(toStored("auditLogs", entry(id, patch)));
  const snapshot = await ref.get();
  return { id: `evento-${id}`, data: snapshot, params: { organizationId: ORG, logId: id } };
}

async function readChain() {
  const seals = await db.collection(paths.collection(ORG, "auditSeals")).get();
  const logs = await db.collection(paths.collection(ORG, "auditLogs")).get();
  return {
    seals: seals.docs.map((document) => fromStored("auditSeals", document.id, document.data())),
    entries: logs.docs.map((document) => fromStored("auditLogs", document.id, document.data())),
  };
}

beforeAll(async () => {
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: "demo-atendara" });
  db = getFirestore();
  await db.doc(paths.organization(ORG)).set({ name: "Organização fictícia do selo" });
});

afterAll(async () => {
  await db.recursiveDelete(db.doc(paths.organization(ORG)));
  if (getApps().length) await deleteApp(app);
});

describe("selo da trilha", () => {
  it("sela a entrada com indice, horario do servidor e corrente", async () => {
    const event = await writeLog("log-1");
    expect(await handleAuditLogCreated(event)).toMatchObject({ sealed: true, index: 1 });

    const seal = fromStored("auditSeals", "log-1", (await sealRef("log-1").get()).data());
    expect(seal).toMatchObject({ index: 1, logId: "log-1", organizationId: ORG, previousSealHash: null });
    // O horario e o da escrita no servidor, nao o `occurredAt` que o cliente
    // mandou: por isso difere do campo da entrada.
    expect(seal.writtenAt).toBe(event.data.createTime.toDate().toISOString());
    expect(seal.writtenAt).not.toBe(AT);
    expect((await chainRef().get()).data()).toMatchObject({ index: 1, sealHash: seal.sealHash });

    const segundo = await writeLog("log-2");
    expect(await handleAuditLogCreated(segundo)).toMatchObject({ sealed: true, index: 2 });
    const { seals, entries } = await readChain();
    expect(verifyAuditSealChain({ seals, entries })).toMatchObject({ ok: true, sealed: 2 });
  });

  it("reentrega do mesmo evento nao duplica indice nem move a corrente", async () => {
    const event = await writeLog("log-reentrega");
    const primeira = await handleAuditLogCreated(event);
    const cabecaDepois = (await chainRef().get()).data();

    const repetida = await handleAuditLogCreated(event);
    expect(repetida).toMatchObject({ sealed: false, reason: "ALREADY_SEALED", index: primeira.index });
    expect((await chainRef().get()).data()).toMatchObject({
      index: cabecaDepois.index,
      sealHash: cabecaDepois.sealHash,
    });

    const { seals, entries } = await readChain();
    expect(seals.filter((seal) => seal.logId === "log-reentrega")).toHaveLength(1);
    expect(verifyAuditSealChain({ seals, entries }).ok).toBe(true);
  });

  it("duas entradas simultaneas recebem indices diferentes e a corrente fecha", async () => {
    const [primeiro, segundo] = await Promise.all([writeLog("log-par-a"), writeLog("log-par-b")]);
    const resultados = await Promise.all([
      handleAuditLogCreated(primeiro),
      handleAuditLogCreated(segundo),
    ]);
    const indices = resultados.map((resultado) => resultado.index).sort((left, right) => left - right);
    expect(new Set(indices).size).toBe(2);
    expect(indices[1]).toBe(indices[0] + 1);

    const { seals, entries } = await readChain();
    expect(verifyAuditSealChain({ seals, entries })).toMatchObject({ ok: true });
  });

  it("acusa entrada adulterada depois de selada", async () => {
    const event = await writeLog("log-adulterada");
    await handleAuditLogCreated(event);
    // So o SDK administrativo chega aqui: pelas regras, `update` em `auditLogs`
    // e negado para todo papel. E exatamente o cenario que o selo existe para
    // tornar visivel.
    await logRef("log-adulterada").update({ action: "DELETE" });

    const { seals, entries } = await readChain();
    const resultado = verifyAuditSealChain({ seals, entries });
    expect(resultado.ok).toBe(false);
    expect(resultado.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "ENTRY_CHANGED", logId: "log-adulterada" })]),
    );
    await logRef("log-adulterada").update({ action: "CREATE" });
    expect(verifyAuditSealChain(await readChain()).ok).toBe(true);
  });

  it("acusa buraco quando um selo e removido", async () => {
    const event = await writeLog("log-removida");
    const { index } = await handleAuditLogCreated(event);
    const removido = fromStored("auditSeals", "log-removida", (await sealRef("log-removida").get()).data());
    await sealRef("log-removida").delete();

    const resultado = verifyAuditSealChain(await readChain());
    expect(resultado.ok).toBe(false);
    expect(resultado.problems.map((problema) => problema.kind)).toEqual(
      expect.arrayContaining(["SEAL_MISSING"]),
    );
    // A entrada sem selo e a ultima da corrente neste teste; selar de novo
    // recompoe o mesmo indice, porque o resumo nao depende de quando o gatilho
    // rodou.
    await chainRef().update({ index: index - 1, sealHash: removido.previousSealHash });
    const refeito = await handleAuditLogCreated(event);
    expect(refeito).toMatchObject({ sealed: true, index });
    expect(verifyAuditSealChain(await readChain()).ok).toBe(true);
  });
});
