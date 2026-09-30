/**
 * Migracao 5.5 — execucao contra o Firestore.
 *
 *   node functions/migrate-scope.js atendo-a3481                 # simulacao (padrao)
 *   node functions/migrate-scope.js atendo-a3481 --org <id>      # uma organizacao
 *   node functions/migrate-scope.js atendo-a3481 --decisions .local/decisoes-5-5.json
 *   node functions/migrate-scope.js atendo-a3481 --actor <uid> --apply # grava
 *
 * Simulacao e o padrao: sem `--apply` nada e escrito. O relatorio (contagens
 * antes/depois e ids, sem nomes nem contatos) vai para `.local/`, que nao e
 * versionado. Com `--apply`, cada organizacao e tratada sozinha:
 *
 * 1. so e gravada se nao tiver pendencia manual (organizacao ambigua continua
 *    fechada ate as decisoes entrarem no arquivo);
 * 2. grava `SCOPE_MIGRATION_STARTED` na trilha da plataforma, depois as
 *    escritas em lotes, e confere lendo de novo: o plano tem de voltar vazio;
 * 3. so entao grava `SCOPE_MIGRATION_COMPLETED` (ou `..._FAILED`). O `--actor`
 *    precisa ser uma conta administrativa ativa e, em producao, corresponder
 *    ao e-mail autenticado no Firebase CLI.
 *
 * O projeto tem de ser informado por extenso. Contra o emulador
 * (FIRESTORE_EMULATOR_HOST), aceita apenas projetos `demo-*`.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { adcFileName, installCleanup, removeLeftovers } from "./adc-credential.js";
import { messagesPath, paths } from "./generated/paths.js";
import { DERIVED_COLLECTIONS, planScopeMigration, SCOPE_MIGRATION_VERSION } from "./scope-migration.js";

const PRODUCTION_PROJECT = "atendo-a3481";
const BATCH_SIZE = 400;
const REASON = "Migração 5.5 do escopo por vínculo profissional";

const args = process.argv.slice(2);
const projectId = args[0];
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : null;
};
const apply = flag("--apply");
const onlyOrganization = option("--org");
const decisionsFile = option("--decisions");
const actorId = option("--actor");
const runId = randomUUID();

if (apply && (!actorId || actorId.startsWith("--") || actorId.includes("/"))) {
  throw new Error("Com --apply, informe --actor <uid-da-operadora>.");
}

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (emulator ? !projectId?.startsWith("demo-") : projectId !== PRODUCTION_PROJECT) {
  throw new Error(emulator
    ? "Contra o emulador use um projeto demo-*."
    : `Informe explicitamente o projeto ${PRODUCTION_PROJECT}.`);
}

let adcPath = null;
let cliEmail = null;
if (emulator) {
  initializeApp({ projectId });
} else {
  const require = createRequire(import.meta.url);
  const firebaseCliAuth = require("../.local/firebase-tools/node_modules/firebase-tools/lib/auth.js");
  const firebaseCliApi = require("../.local/firebase-tools/node_modules/firebase-tools/lib/api.js");
  const cliAccount = firebaseCliAuth.getGlobalDefaultAccount();
  if (!cliAccount?.tokens?.refresh_token) throw new Error("Execute firebase login antes da migração.");
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
  initializeApp({ credential: applicationDefault(), projectId });
}

const db = getFirestore();

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

async function list(organizationId, collection) {
  const snapshot = await db.collection(paths.collection(organizationId, collection)).get();
  return snapshot.docs.map((document) => ({ id: document.id, path: document.ref.path, data: document.data() }));
}

async function load(organizationId) {
  const names = [...new Set([...DERIVED_COLLECTIONS.filter((name) => name !== "messages"), "clients", "aiDecisions", "aiRules"])];
  const [members, professionals, ...lists] = await Promise.all([
    list(organizationId, "members"),
    list(organizationId, "professionals"),
    ...names.map((name) => list(organizationId, name)),
  ]);
  const docs = Object.fromEntries(names.map((name, index) => [name, lists[index]]));
  docs.messages = [];
  for (const conversation of docs.conversations) {
    const snapshot = await db.collection(messagesPath(organizationId, conversation.id)).get();
    docs.messages.push(...snapshot.docs.map((document) => ({
      id: document.id, path: document.ref.path, data: document.data(), parentId: conversation.id,
    })));
  }
  return { members, professionals, docs };
}

const decisions = decisionsFile ? JSON.parse(await readFile(decisionsFile, "utf8")) : {};

function summarize(plan) {
  const byCollection = {};
  for (const write of plan.writes) byCollection[write.collection] = (byCollection[write.collection] ?? 0) + 1;
  return {
    status: plan.status,
    professionalsActive: plan.professionals.active,
    unresolvedMembersBefore: plan.counts.unresolvedMembersBefore,
    unresolvedMembersAfter: plan.counts.unresolvedMembersAfter,
    writesByCollection: byCollection,
    manual: plan.manual.length,
    organizationLevel: plan.organizationLevel.length,
    problems: plan.problems.length,
  };
}

async function audit(organizationId, action, details) {
  const id = randomUUID();
  await db.doc(paths.platformAuditLog(id)).create({
    id, action, actorId, organizationId, targetUserId: null, reason: REASON,
    details: { runId, tool: "scope-migration", version: SCOPE_MIGRATION_VERSION, ...details },
    createdAt: new Date().toISOString(),
  });
}

async function commit(writes) {
  for (let start = 0; start < writes.length; start += BATCH_SIZE) {
    const batch = db.batch();
    for (const write of writes.slice(start, start + BATCH_SIZE)) batch.update(db.doc(write.path), write.patch);
    await batch.commit();
  }
}

const report = { runId, projectId, actorId: actorId ?? null, version: SCOPE_MIGRATION_VERSION, mode: apply ? "APPLY" : "DRY_RUN", startedAt: new Date().toISOString(), organizations: [] };
let exitCode = 0;
try {
  await validateActor();
  const organizations = (await db.collection(paths.organizations()).select().get()).docs
    .map((document) => document.id)
    .filter((id) => !onlyOrganization || id === onlyOrganization);
  if (onlyOrganization && organizations.length === 0) throw new Error("Organização não encontrada.");

  for (const organizationId of organizations) {
    const plan = planScopeMigration({ organizationId, ...(await load(organizationId)), decisions: decisions[organizationId] ?? null });
    const entry = { organizationId, ...summarize(plan), counts: plan.counts.collections, manualItems: plan.manual, problems: plan.problems, writes: plan.writes.map(({ collection, id, source }) => ({ collection, id, source })) };
    report.organizations.push(entry);
    console.log(`${organizationId}: ${plan.status} — ${plan.writes.length} escrita(s), ${plan.manual.length} pendência(s) manual(is), membros sem escopo ${plan.counts.unresolvedMembersBefore} → ${plan.counts.unresolvedMembersAfter}`);
    if (plan.status === "NEEDS_REVIEW") exitCode = 2;
    if (!apply || plan.status !== "READY") continue;

    await audit(organizationId, "SCOPE_MIGRATION_STARTED", { planned: summarize(plan) });
    try {
      await commit(plan.writes);
      const verification = planScopeMigration({ organizationId, ...(await load(organizationId)), decisions: decisions[organizationId] ?? null });
      if (verification.status !== "CLEAN") {
        throw new Error(`A conferência terminou em ${verification.status}: ${verification.writes.length} escrita(s), ${verification.manual.length} pendência(s) e ${verification.problems.length} problema(s).`);
      }
      entry.after = summarize(verification);
      await audit(organizationId, "SCOPE_MIGRATION_COMPLETED", { applied: summarize(plan), after: entry.after });
      console.log(`  ✔ ${organizationId}: aplicada e conferida.`);
    } catch (error) {
      entry.failed = error.message;
      exitCode = 1;
      await audit(organizationId, "SCOPE_MIGRATION_FAILED", { message: String(error.message).slice(0, 200) }).catch(() => {});
      console.error(`  ✘ ${organizationId}: ${error.message}`);
    }
  }
} finally {
  if (adcPath) await unlink(adcPath).catch(() => {});
}

report.finishedAt = new Date().toISOString();
await mkdir(".local", { recursive: true });
const reportPath = option("--report") ?? `.local/scope-migration-${runId}.json`;
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`Relatório: ${reportPath}`);
if (exitCode === 2) console.log("Há organização com pendência manual: ela continua fechada. Registre as decisões e rode de novo.");
process.exitCode = exitCode;
