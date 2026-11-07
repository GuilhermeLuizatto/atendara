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
import { resolve } from "node:path";

import { adcFileName, installCleanup, removeLeftovers } from "./adc-credential.js";
import {
  SENSITIVE_PREFIXES,
  metadataWithoutToken,
  planRevocation,
} from "./download-token-revocation.js";
import { paths } from "./generated/paths.js";

const PRODUCTION_PROJECT = "atendo-a3481";
const REASON = "Revogação dos links de download antigos (revisão de segurança de 10/10/2026)";

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
  const firebaseCliAuth = require("../.local/firebase-tools/node_modules/firebase-tools/lib/auth.js");
  const firebaseCliApi = require("../.local/firebase-tools/node_modules/firebase-tools/lib/api.js");
  const cliAccount = firebaseCliAuth.getGlobalDefaultAccount();
  if (!cliAccount?.tokens?.refresh_token) throw new Error("Execute firebase login antes da revogação.");
  cliEmail = cliAccount.user?.email?.trim().toLowerCase() ?? null;
  await mkdir(".local", { recursive: true });
  const leftovers = removeLeftovers(resolve(".local"));
  if (leftovers.length > 0) console.warn(`Credencial de execução anterior apagada: ${leftovers.join(", ")}`);
  adcPath = resolve(".local", adcFileName());
  await writeFile(adcPath, JSON.stringify({
    type: "authorized_user",
    client_id: firebaseCliApi.clientId(),
    client_secret: firebaseCliApi.clientSecret(),
    refresh_token: cliAccount.tokens.refresh_token,
    quota_project_id: projectId,
  }), { flag: "wx" });
  installCleanup(adcPath);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
  initializeApp({ credential: applicationDefault(), projectId, storageBucket: bucketName });
}

const db = getFirestore();
const bucket = getStorage().bucket(bucketName);

async function validateActor() {
  if (!apply) return;
  const account = (await db.doc(paths.account(actorId)).get()).data();
  if (
    !account ||
    account.userId !== actorId ||
    account.platformRole !== "PLATFORM_ADMIN" ||
    account.status !== "ACTIVE" ||
    account.mustChangePassword
  ) {
    throw new Error("O --actor deve identificar uma conta administrativa ativa e liberada da plataforma.");
  }
  if (!emulator && (!cliEmail || account.email?.trim().toLowerCase() !== cliEmail)) {
    throw new Error("O --actor não corresponde à conta usada pelo firebase login.");
  }
}

async function audit(action, details) {
  const id = randomUUID();
  await db.doc(paths.platformAuditLog(id)).create({
    id, action, actorId, organizationId: null, targetUserId: null, reason: REASON,
    details: { runId, tool: "revoke-download-tokens", ...details },
    createdAt: new Date().toISOString(),
  });
}

/** Mesmos bytes e metadados, sem o token; falha se o objeto mudou no meio. */
async function rewriteWithoutToken(name) {
  const file = bucket.file(name);
  const [metadata] = await file.getMetadata();
  const [bytes] = await file.download();
  await file.save(bytes, {
    resumable: false,
    contentType: metadata.contentType,
    preconditionOpts: { ifGenerationMatch: metadata.generation },
    metadata: {
      cacheControl: metadata.cacheControl ?? "private, max-age=0",
      contentDisposition: metadata.contentDisposition,
      metadata: metadataWithoutToken(metadata.metadata),
    },
  });
}

async function listObjects() {
  const objects = [];
  for (const prefix of SENSITIVE_PREFIXES) {
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) objects.push({ name: file.name, metadata: file.metadata?.metadata ?? {} });
  }
  return objects;
}

const report = {
  runId, projectId, bucket: bucketName, actorId: actorId ?? null,
  mode: apply ? "APPLY" : "DRY_RUN", startedAt: new Date().toISOString(),
};
let exitCode = 0;
try {
  await validateActor();
  const objects = await listObjects();
  const plan = planRevocation(objects);
  report.planned = { inspected: plan.inspected, alreadyClean: plan.alreadyClean, toRevoke: plan.revoke.length, byOrganization: plan.byOrganization };
  console.log(`Objetos sensíveis: ${plan.inspected}. Com link antigo: ${plan.revoke.length}. Já limpos: ${plan.alreadyClean}.`);

  if (apply && plan.revoke.length > 0) {
    await audit("DOWNLOAD_TOKENS_REVOCATION_STARTED", { planned: report.planned });
    const failed = [];
    for (const name of plan.revoke) {
      try {
        await rewriteWithoutToken(name);
      } catch (error) {
        failed.push({ name, message: String(error.message).slice(0, 200) });
      }
    }
    const remaining = planRevocation(await listObjects()).revoke;
    report.after = { stillExposed: remaining.length };
    report.failed = failed;
    if (failed.length > 0 || remaining.length > 0) {
      exitCode = 1;
      await audit("DOWNLOAD_TOKENS_REVOCATION_FAILED", { failed: failed.length, remaining: remaining.length }).catch(() => {});
      console.error(`✘ ${failed.length} falha(s); ${remaining.length} objeto(s) com o link antigo.`);
    } else {
      await audit("DOWNLOAD_TOKENS_REVOCATION_COMPLETED", { revoked: plan.revoke.length });
      console.log(`✔ ${plan.revoke.length} link(s) antigo(s) revogado(s) e conferido(s).`);
    }
  } else if (!apply) {
    console.log("Simulação: nada foi alterado. Rode com --actor <uid> --apply para revogar.");
  }
} catch (error) {
  exitCode = 1;
  report.error = String(error.message).slice(0, 300);
  console.error(`✘ ${error.message}`);
} finally {
  if (adcPath) await unlink(adcPath).catch(() => {});
}

report.finishedAt = new Date().toISOString();
await mkdir(".local", { recursive: true });
const reportPath = `.local/revoke-download-tokens-${runId}.json`;
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`Relatório: ${reportPath}`);
process.exitCode = exitCode;
