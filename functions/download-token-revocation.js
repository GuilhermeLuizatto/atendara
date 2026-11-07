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
