import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * Cuidado com a credencial temporaria dos scripts de console.
 *
 * Para falar com o projeto real sem arquivo de conta de servico, os scripts
 * derivam uma credencial do token da CLI e a gravam em `.local`. Esse arquivo
 * carrega um token de atualizacao de longa duracao: cada minuto a mais no disco
 * e risco.
 *
 * O `finally` do script cobre o fim normal e a excecao. NAO cobre Ctrl+C nem
 * `SIGTERM` — e nada cobre `SIGKILL` ou queda de energia. Por isso sao duas
 * defesas: apagar ao receber o sinal, e varrer a sobra na proxima execucao.
 */

const LEFTOVER = /^\.firebase-cli-adc-.*\.json$/;

/** Nome do arquivo desta execucao. O pid evita duas execucoes se atropelarem. */
export function adcFileName(pid = process.pid) {
  return `.firebase-cli-adc-${pid}.json`;
}

/**
 * Apaga credenciais deixadas por execucoes anteriores que morreram antes do
 * `finally`. Devolve o que apagou, para o script poder avisar.
 */
export function removeLeftovers(directory, { readdir = readdirSync, unlink = unlinkSync } = {}) {
  let entries;
  try {
    entries = readdir(directory);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of entries) {
    if (!LEFTOVER.test(name)) continue;
    try {
      unlink(join(directory, name));
      removed.push(name);
    } catch {
      // Arquivo em uso por outra execucao viva: deixa para ela.
    }
  }
  return removed;
}

/**
 * Apaga o arquivo quando o processo termina, inclusive por sinal.
 *
 * `unlinkSync` de proposito: um manipulador de sinal nao tem quem espere uma
 * promessa. Devolve a funcao de limpeza para o teste e para uso direto.
 */
export function installCleanup(
  path,
  { on = process.on.bind(process), unlink = unlinkSync, exit = process.exit.bind(process) } = {},
) {
  const remove = () => {
    try {
      unlink(path);
    } catch {
      // Ja apagado pelo `finally`: nada a fazer.
    }
  };

  on("exit", remove);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    on(signal, () => {
      remove();
      // 128 + numero do sinal e a convencao de shell para "morri por sinal".
      exit(signal === "SIGINT" ? 130 : 143);
    });
  }
  return remove;
}
