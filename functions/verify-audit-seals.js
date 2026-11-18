/**
 * Confere a trilha selada de uma organizacao, ou de todas.
 *
 *   node functions/verify-audit-seals.js atendo-a3481
 *   node functions/verify-audit-seals.js atendo-a3481 --organizacao <orgId>
 *   node functions/verify-audit-seals.js atendo-a3481 --selado-desde 2026-11-18T00:00:00.000Z
 *
 * **Somente leitura.** Nao escreve nada, em lugar nenhum: nem na trilha, nem no
 * selo, nem na trilha da plataforma. Le `auditLogs` e `auditSeals` de cada
 * organizacao e recalcula a corrente (`verifyAuditSealChain`), acusando buraco,
 * indice repetido, elo errado, selo adulterado, entrada adulterada nos campos
 * protegidos, entrada sem selo e selo sem entrada.
 *
 * Roda com a credencial da CLI (`firebase login`), derivada para `.local` e
 * apagada no fim, como os outros scripts de console. O relatorio vai para
 * `.local/` e carrega so id de entrada, indice e tipo de problema — nenhum dado
 * pessoal.
 *
 * O que ele NAO prova: que a entrada diz a verdade. Entrada inventada em nome
 * proprio e selada como qualquer outra, e por isso aparece aqui como corrente
 * integra. O selo torna a trilha detectavel, nao verdadeira.
 *
 * Contra o emulador (FIRESTORE_EMULATOR_HOST), aceita apenas projetos `demo-*`.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { createCliCredential } from "./adc-credential.js";
import { buildReport, formatLines, parseVerifyArguments, verifyOrganization } from "./audit-seal-report.js";
import { fromStored } from "./firestore-dates.js";
import { paths } from "./generated/paths.js";

const PAGE = 500;

const { projectId, emulator, organizationId, sealedFrom } = parseVerifyArguments(process.argv.slice(2));
const runId = randomUUID();

let adcPath = null;
if (emulator) {
  initializeApp({ projectId });
} else {
  const require = createRequire(import.meta.url);
  ({ adcPath } = await createCliCredential({
    projectId,
    loginMessage: "Execute firebase login antes da conferência.",
    loadCli: () => ({
      auth: require("../.local/firebase-tools/node_modules/firebase-tools/lib/auth.js"),
      api: require("../.local/firebase-tools/node_modules/firebase-tools/lib/api.js"),
    }),
  }));
  initializeApp({ credential: applicationDefault(), projectId });
}

const db = getFirestore();

/** Uma colecao inteira, em paginas por id: trilha grande nao cabe numa leitura. */
async function readAll(organization, collection) {
  const documents = [];
  let after = null;
  for (;;) {
    let query = db.collection(paths.collection(organization, collection)).orderBy(FieldPath.documentId()).limit(PAGE);
    if (after) query = query.startAfter(after);
    const page = await query.get();
    if (page.empty) break;
    for (const document of page.docs) documents.push(fromStored(collection, document.id, document.data()));
    if (page.size < PAGE) break;
    after = page.docs.at(-1).id;
  }
  return documents;
}

async function organizationIds() {
  if (organizationId) return [organizationId];
  const snapshot = await db.collection(paths.organizations()).select().get();
  return snapshot.docs.map((document) => document.id);
}

let outcome;
try {
  const organizations = [];
  for (const organization of await organizationIds()) {
    const [seals, entries] = await Promise.all([
      readAll(organization, "auditSeals"),
      readAll(organization, "auditLogs"),
    ]);
    // Organizacao sem trilha nenhuma nao e caso: nao ha o que conferir, e
    // listar todas as vazias esconderia as que importam.
    if (seals.length === 0 && entries.length === 0) continue;
    organizations.push(verifyOrganization({ organizationId: organization, seals, entries, sealedFrom }));
  }
  outcome = buildReport({ projectId, runId, at: new Date().toISOString(), organizations });
} finally {
  if (adcPath) await unlink(adcPath).catch(() => {});
}

for (const line of formatLines(outcome.report)) console.log(line);

await mkdir(".local", { recursive: true });
const reportPath = `.local/conferencia-do-selo-${runId}.json`;
await writeFile(reportPath, JSON.stringify(outcome.report, null, 2));
console.log(`Relatório: ${reportPath}`);
process.exitCode = outcome.exitCode;
