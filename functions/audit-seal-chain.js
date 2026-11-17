import { createHash } from "node:crypto";

import { APPEND_ONLY_PROTECTED_FIELDS } from "./generated/privacy-config.js";

/**
 * Selo da trilha: a parte que so calcula (secao 4 do plano das trilhas).
 *
 * **O que o selo resolve.** A trilha (`auditLogs`) e escrita pelo navegador, em
 * nome do proprio membro. As regras ja garantem append-only e autor igual ao
 * usuario, mas nada prova que a sequencia entregue depois e a mesma que foi
 * escrita. O selo e uma corrente: cada entrada ganha um registro com indice
 * sequencial, horario do servidor, resumo da entrada e resumo do selo anterior.
 * Tirar, reordenar ou alterar uma entrada quebra a corrente e aparece na
 * verificacao.
 *
 * **O que o selo NAO resolve, e e aceito por escrito.** Entrada inventada em
 * nome proprio continua possivel: um membro autenticado pode registrar um fato
 * que nao aconteceu, e o selo vai selar essa entrada como qualquer outra. O
 * selo torna a trilha *detectavel*, nao *verdadeira*. A decisao do titular de
 * 17/11/2026 aceita esse risco residual enquanto as 26 operacoes nao migram
 * para callables (item 3.4 do checklist do piloto).
 *
 * **Por que o resumo cobre so os campos protegidos.** A pseudonimizacao
 * (`functions/privacy.js`) troca `summary`, `actorName` e `resource.id` a pedido
 * do titular ou na exclusao da organizacao — e isso e legitimo. Se o resumo
 * cobrisse esses campos, todo atendimento a um titular quebraria a corrente e a
 * verificacao passaria a mentir. Entao o resumo cobre exatamente
 * `APPEND_ONLY_PROTECTED_FIELDS.auditLogs`, que e o conjunto que NINGUEM pode
 * mudar — nem o backend. Em troca, alteracao dos campos pseudonimizaveis nao e
 * detectada pelo selo; ela fica marcada por `privacyRedaction`, com o id do
 * pedido, que e a prova daquele caminho.
 *
 * Sem I/O: isto e so calculo, e por isso a verificacao roda sobre dados lidos
 * em qualquer lugar — teste, emulador ou uma conferencia pontual em producao.
 */

/** Versao do formato do selo. Entra no resumo: trocar o formato muda o hash. */
export const SEAL_VERSION = 1;

/** Campos da entrada que o resumo cobre. Imutaveis por decisao, nao por acaso. */
export const SEALED_ENTRY_FIELDS = APPEND_ONLY_PROTECTED_FIELDS.auditLogs;

/**
 * Ordem por codigo de caractere, NAO por `localeCompare`.
 *
 * A ordem local depende do idioma de quem roda o codigo: com ela, a mesma
 * entrada geraria resumos diferentes em maquinas diferentes, e a corrente
 * passaria a acusar adulteracao onde nao houve. Aqui a comparacao precisa ser
 * sempre a mesma, nao "correta para humanos".
 */
function byCodeUnit(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Valor de um caminho com ponto (`resource.type`), sem depender de lodash. */
function valueAt(data, path) {
  let current = data;
  for (const part of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return null;
    current = current[part];
  }
  return current === undefined ? null : current;
}

/**
 * Serializacao canonica: chaves em ordem, `Timestamp` e `Date` em ISO.
 *
 * `JSON.stringify` puro nao serve porque a ordem das chaves acompanha a ordem
 * de insercao: a mesma entrada lida de dois caminhos diferentes geraria dois
 * resumos. O `toDate` por pato mantem este arquivo sem SDK.
 */
export function canonical(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "object" && typeof value.toDate === "function") {
    return JSON.stringify(value.toDate().toISOString());
  }
  if (typeof value !== "object") return "null";
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort(byCodeUnit);
  const pairs = keys.map((key) => JSON.stringify(key) + ":" + canonical(value[key]));
  return "{" + pairs.join(",") + "}";
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Resumo da entrada: os campos protegidos, o id e o horario do servidor.
 *
 * O id entra porque mover o conteudo de uma entrada para outro documento
 * mudaria quem a escreveu sem mudar o corpo. O horario entra porque e o dado
 * que o cliente nao escolhe — `occurredAt` ele escolhe.
 */
export function entryDigest({ logId, entry, writtenAt }) {
  const sealed = {};
  for (const field of SEALED_ENTRY_FIELDS) sealed[field] = valueAt(entry, field);
  return sha256(canonical({ v: SEAL_VERSION, logId, writtenAt, sealed }));
}

/** Resumo do proprio selo. E o elo que o selo seguinte guarda. */
export function sealDigest({ index, logId, entryHash, previousSealHash, writtenAt }) {
  return sha256(
    canonical({ v: SEAL_VERSION, index, logId, entryHash, previousSealHash: previousSealHash ?? null, writtenAt }),
  );
}

/**
 * O selo da proxima entrada, dado o ultimo selo da organizacao.
 *
 * `previous` e a cabeca da corrente (`auditSealChains/organization`), ou `null`
 * na primeira entrada. Quem chama grava selo e cabeca na MESMA transacao: e o
 * que impede duas entradas simultaneas de receberem o mesmo indice.
 */
export function nextSeal({ logId, entry, writtenAt, previous = null }) {
  const index = (previous?.index ?? 0) + 1;
  const previousSealHash = previous?.sealHash ?? null;
  const entryHash = entryDigest({ logId, entry, writtenAt });
  return {
    version: SEAL_VERSION,
    index,
    logId,
    writtenAt,
    entryHash,
    previousSealHash,
    sealHash: sealDigest({ index, logId, entryHash, previousSealHash, writtenAt }),
  };
}

const problem = (kind, detail) => ({ kind, ...detail });

/** Buraco ou indice repetido: os dois jeitos de a sequencia nao fechar. */
function sequenceProblem(seal, expected) {
  if (seal.index === expected) return null;
  const kind = seal.index < expected ? "DUPLICATE_INDEX" : "GAP";
  // O `logId` diz QUAL selo apareceu fora de lugar; sem ele, a conferencia
  // acusaria um buraco sem dizer onde procurar.
  return problem(kind, { index: seal.index, expected, logId: seal.logId });
}

/** Elo com o selo anterior e resumo do proprio selo. */
function sealProblems(seal, previousSealHash) {
  const found = [];
  if ((seal.previousSealHash ?? null) !== previousSealHash) {
    found.push(problem("BROKEN_LINK", { index: seal.index, logId: seal.logId }));
  }
  if (sealDigest(seal) !== seal.sealHash) {
    found.push(problem("SEAL_CHANGED", { index: seal.index, logId: seal.logId }));
  }
  return found;
}

/** A entrada que o selo aponta: existe? continua a mesma nos campos protegidos? */
function entryProblem(seal, entry) {
  if (!entry) return problem("ENTRY_MISSING", { index: seal.index, logId: seal.logId });
  const entryHash = entryDigest({ logId: seal.logId, entry, writtenAt: seal.writtenAt });
  if (entryHash !== seal.entryHash) return problem("ENTRY_CHANGED", { index: seal.index, logId: seal.logId });
  return null;
}

/** Entrada que nenhum selo cobre: falta de selo, ou trilha anterior ao selo. */
function unsealedProblems(entries, sealedIds, from) {
  const found = [];
  let outsideChain = 0;
  for (const entry of entries) {
    if (sealedIds.has(entry.id)) continue;
    const at = Date.parse(entry.createdAt ?? entry.occurredAt ?? "");
    if (from !== null && Number.isFinite(at) && at < from) outsideChain += 1;
    else found.push(problem("SEAL_MISSING", { logId: entry.id }));
  }
  return { found, outsideChain };
}

/**
 * Conferencia da corrente. So calculo: recebe o que foi lido e devolve o que
 * nao fecha.
 *
 * - `seals`: os selos da organizacao, em qualquer ordem.
 * - `entries`: as entradas da trilha, com `id`, no formato do dominio.
 * - `sealedFrom`: ISO a partir do qual a trilha e selada. Entrada escrita antes
 *   do selo existir nao tem selo e nao e defeito; sem este limite, ligar o selo
 *   numa organizacao antiga acusaria buraco em toda a trilha anterior.
 *
 * Detecta: buraco e indice repetido (remocao), elo errado (reordenacao ou selo
 * trocado), resumo do selo que nao fecha (selo adulterado), resumo da entrada
 * que nao fecha (entrada adulterada nos campos protegidos), entrada sem selo e
 * selo sem entrada.
 */
export function verifyAuditSealChain({ seals = [], entries = [], sealedFrom = null } = {}) {
  const problems = [];
  const ordered = [...seals].sort((left, right) => left.index - right.index);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const sealedIds = new Set();

  let expected = 1;
  let previousSealHash = null;
  for (const seal of ordered) {
    const outOfSequence = sequenceProblem(seal, expected);
    if (outOfSequence) problems.push(outOfSequence);
    problems.push(...sealProblems(seal, previousSealHash));

    const entry = byId.get(seal.logId);
    if (entry) sealedIds.add(seal.logId);
    const broken = entryProblem(seal, entry);
    if (broken) problems.push(broken);

    // O elo seguinte guarda o resumo GRAVADO, nao o recalculado: e assim que a
    // cadeia se rompe num ponto so, em vez de acusar todos os selos adiante. E
    // a sequencia segue do indice encontrado, para um buraco nao virar erro em
    // cascata.
    previousSealHash = seal.sealHash;
    expected = seal.index + 1;
  }

  const unsealed = unsealedProblems(entries, sealedIds, sealedFrom ? Date.parse(sealedFrom) : null);
  problems.push(...unsealed.found);

  return { ok: problems.length === 0, problems, sealed: sealedIds.size, outsideChain: unsealed.outsideChain };
}
