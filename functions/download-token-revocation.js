/**
 * Revogacao dos links de download antigos (revisao de 10/10/2026, achado 3).
 *
 * Arquivo enviado pelo SDK do navegador ganha `firebaseStorageDownloadTokens`
 * nos metadados. Enquanto o token existir, qualquer URL `?alt=media&token=`
 * emitida antes continua abrindo o arquivo, mesmo depois de suspensao ou
 * vencimento. Os uploads atuais passam pelo backend e nao criam token; sobra
 * invalidar o token dos objetos antigos.
 *
 * Atualizar so o metadado nao basta: o Storage trata a chave como lista e, no
 * emulador, acrescenta o token novo sem tirar o antigo. Por isso o objeto e
 * regravado pelo backend, com os mesmos bytes e metadados menos o token, sob
 * condicao de geracao para nao atropelar escrita concorrente.
 *
 * Logo da organizacao fica de fora de proposito: e exibido por URL publica e
 * nao e dado sensivel.
 */
export const SENSITIVE_PREFIXES = Object.freeze(["paymentProofs/", "support/"]);

export const DOWNLOAD_TOKEN_KEY = "firebaseStorageDownloadTokens";

export function isSensitivePath(name) {
  return typeof name === "string" && SENSITIVE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function hasDownloadToken(customMetadata) {
  const value = customMetadata?.[DOWNLOAD_TOKEN_KEY];
  return typeof value === "string" && value.trim().length > 0;
}

/** Organizacao dona do objeto, pelo segundo segmento do caminho. */
export function organizationOf(name) {
  const [, organizationId] = String(name).split("/");
  return organizationId || null;
}

/**
 * Recebe `{ name, metadata }` de cada objeto e devolve o que revogar. So
 * contagens e caminhos; nenhum token entra no plano nem no relatorio.
 */
export function planRevocation(objects) {
  const revoke = [];
  const byOrganization = {};
  let inspected = 0;
  let alreadyClean = 0;
  for (const object of objects) {
    if (!isSensitivePath(object?.name)) continue;
    inspected += 1;
    if (!hasDownloadToken(object.metadata)) {
      alreadyClean += 1;
      continue;
    }
    revoke.push(object.name);
    const organizationId = organizationOf(object.name) ?? "desconhecida";
    byOrganization[organizationId] = (byOrganization[organizationId] ?? 0) + 1;
  }
  return { inspected, alreadyClean, revoke, byOrganization };
}

/** Metadados personalizados do objeto regravado: tudo, menos o token. */
export function metadataWithoutToken(customMetadata) {
  const rest = { ...(customMetadata ?? {}) };
  delete rest[DOWNLOAD_TOKEN_KEY];
  return rest;
}

const REASON = "Revogação dos links de download antigos (revisão de segurança de 10/10/2026)";

/** Mesmos bytes e metadados, sem o token; falha se o objeto mudou no meio. */
export async function rewriteWithoutToken(bucket, name) {
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

async function listObjects(bucket) {
  const objects = [];
  for (const prefix of SENSITIVE_PREFIXES) {
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) objects.push({ name: file.name, metadata: file.metadata?.metadata ?? {} });
  }
  return objects;
}

/**
 * Quem pode aplicar: conta ativa e liberada da plataforma e, fora do
 * emulador, a mesma conta do `firebase login`.
 */
export async function validateActor({ db, paths, actorId, cliEmail, emulator }) {
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

/**
 * Simula ou aplica a revogação e devolve o relatório e o código de saída. Os
 * efeitos (Firestore, Storage, relógio, console) entram por parâmetro para o
 * teste provar cada desfecho sem emulador.
 */
export async function runRevocation({
  db, bucket, paths, apply, actorId, cliEmail, emulator, runId, projectId, bucketName,
  now = () => new Date().toISOString(), log = console.log, logError = console.error,
  newId = () => crypto.randomUUID(),
}) {
  const audit = async (action, details) => {
    const id = newId();
    await db.doc(paths.platformAuditLog(id)).create({
      id, action, actorId, organizationId: null, targetUserId: null, reason: REASON,
      details: { runId, tool: "revoke-download-tokens", ...details },
      createdAt: now(),
    });
  };
  const report = {
    runId, projectId, bucket: bucketName, actorId: actorId ?? null,
    mode: apply ? "APPLY" : "DRY_RUN", startedAt: now(),
  };
  let exitCode = 0;
  try {
    if (apply) await validateActor({ db, paths, actorId, cliEmail, emulator });
    const plan = planRevocation(await listObjects(bucket));
    report.planned = { inspected: plan.inspected, alreadyClean: plan.alreadyClean, toRevoke: plan.revoke.length, byOrganization: plan.byOrganization };
    log(`Objetos sensíveis: ${plan.inspected}. Com link antigo: ${plan.revoke.length}. Já limpos: ${plan.alreadyClean}.`);

    if (apply && plan.revoke.length > 0) {
      await audit("DOWNLOAD_TOKENS_REVOCATION_STARTED", { planned: report.planned });
      const failed = [];
      for (const name of plan.revoke) {
        try {
          await rewriteWithoutToken(bucket, name);
        } catch (error) {
          failed.push({ name, message: String(error.message).slice(0, 200) });
        }
      }
      const remaining = planRevocation(await listObjects(bucket)).revoke;
      report.after = { stillExposed: remaining.length };
      report.failed = failed;
      if (failed.length > 0 || remaining.length > 0) {
        exitCode = 1;
        await audit("DOWNLOAD_TOKENS_REVOCATION_FAILED", { failed: failed.length, remaining: remaining.length }).catch(() => {});
        logError(`✘ ${failed.length} falha(s); ${remaining.length} objeto(s) com o link antigo.`);
      } else {
        await audit("DOWNLOAD_TOKENS_REVOCATION_COMPLETED", { revoked: plan.revoke.length });
        log(`✔ ${plan.revoke.length} link(s) antigo(s) revogado(s) e conferido(s).`);
      }
    } else if (!apply) {
      log("Simulação: nada foi alterado. Rode com --actor <uid> --apply para revogar.");
    }
  } catch (error) {
    exitCode = 1;
    report.error = String(error.message).slice(0, 300);
    logError(`✘ ${error.message}`);
  }
  report.finishedAt = now();
  return { report, exitCode };
}
