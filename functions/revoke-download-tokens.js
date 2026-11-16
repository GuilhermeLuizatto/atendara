/**
 * Revoga os links de download antigos de comprovantes e anexos de suporte.
 *
 *   node functions/revoke-download-tokens.js atendo-a3481 --bucket <bucket>                # simulacao (padrao)
 *   node functions/revoke-download-tokens.js atendo-a3481 --bucket <bucket> --actor <uid> --apply
 *
 * Sem `--apply` nada muda: o script lista os objetos de `paymentProofs/` e
 * `support/`, conta os que ainda tem token e grava o relatorio em `.local/`
 * (caminhos e contagens, nunca o token). Com `--apply`, regrava cada objeto
 * com os mesmos bytes e metadados menos o token, confere lendo de novo e
 * registra inicio e fim na trilha da plataforma. Depois disso, toda
 * URL `?token=` emitida antes deixa de abrir o arquivo; a interface atual baixa
 * pelo SDK, com a sessao conferida pelas regras, e nao depende do token.
 *
 * Rodar uma vez antes do piloto e de novo se algum fluxo antigo voltar a
 * enviar arquivo pelo navegador. Contra o emulador
 * (FIREBASE_STORAGE_EMULATOR_HOST), aceita apenas projetos `demo-*`.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { createCliCredential } from "./adc-credential.js";
import { runRevocation } from "./download-token-revocation.js";
import { paths } from "./generated/paths.js";

const PRODUCTION_PROJECT = "atendo-a3481";

const args = process.argv.slice(2);
const projectId = args[0];
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : null;
};
const apply = args.includes("--apply");
const actorId = option("--actor");
const bucketName = option("--bucket");
const runId = randomUUID();

if (!bucketName || bucketName.startsWith("--")) throw new Error("Informe --bucket <nome-do-bucket>.");
if (apply && (!actorId || actorId.startsWith("--") || actorId.includes("/"))) {
  throw new Error("Com --apply, informe --actor <uid-da-operadora>.");
}

const emulator = Boolean(process.env.FIREBASE_STORAGE_EMULATOR_HOST);
if (emulator ? !projectId?.startsWith("demo-") : projectId !== PRODUCTION_PROJECT) {
  throw new Error(emulator
    ? "Contra o emulador use um projeto demo-*."
    : `Informe explicitamente o projeto ${PRODUCTION_PROJECT}.`);
}

let adcPath = null;
let cliEmail = null;
if (emulator) {
  initializeApp({ projectId, storageBucket: bucketName });
} else {
  const require = createRequire(import.meta.url);
  ({ adcPath, cliEmail } = await createCliCredential({
    projectId,
    loginMessage: "Execute firebase login antes da revogação.",
    loadCli: () => ({
    auth: require("../.local/firebase-tools/node_modules/firebase-tools/lib/auth.js"),
    api: require("../.local/firebase-tools/node_modules/firebase-tools/lib/api.js"),
  }),
  }));
  initializeApp({ credential: applicationDefault(), projectId, storageBucket: bucketName });
}

const db = getFirestore();
const bucket = getStorage().bucket(bucketName);

let outcome;
try {
  outcome = await runRevocation({
    db, bucket, paths, apply, actorId, cliEmail, emulator, runId, projectId, bucketName,
  });
} finally {
  if (adcPath) await unlink(adcPath).catch(() => {});
}

await mkdir(".local", { recursive: true });
const reportPath = `.local/revoke-download-tokens-${runId}.json`;
await writeFile(reportPath, JSON.stringify(outcome.report, null, 2));
console.log(`Relatório: ${reportPath}`);
process.exitCode = outcome.exitCode;
