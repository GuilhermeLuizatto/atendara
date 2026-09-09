import type { DateKey } from "@/lib/utils/datetime";


import type { WorkspaceSnapshot } from "../types";

/**
 * Persistencia local do repositorio em memoria.
 *
 * Sem isso, recarregar a pagina apaga tudo o que o usuario criou — o que
 * transforma o prototipo em algo que nao da para explorar de verdade.
 *
 * O estado e guardado por profissao E por dia. Se o dia virou, o conjunto e
 * descartado e regerado: os dados sao ancorados em "hoje", e restaurar uma
 * fotografia de ontem mostraria uma agenda vazia com tudo no passado.
 */

const KEY_PREFIX = "atendo:workspace:";
const WRITE_DELAY_MS = 250;

interface PersistedState {
  dateKey: DateKey;
  sequence: number;
  snapshot: WorkspaceSnapshot;
}

function storageKey(professionId: string): string {
  return `${KEY_PREFIX}${professionId}`;
}

export function loadState(
  professionId: string,
  dateKey: DateKey,
): PersistedState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey(professionId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.dateKey !== dateKey) return null;
    if (!parsed.snapshot?.organization?.id) return null;

    return parsed;
  } catch {
    // JSON corrompido ou storage bloqueado: recomeca do conjunto gerado.
    return null;
  }
}

/**
 * Escrita adiada: uma sequencia de mutacoes (criar atendimento gera receita,
 * recalcula agregados, grava auditoria) produz varios commits seguidos, e
 * serializar o conjunto inteiro em cada um seria desperdicio.
 */
export function createStateWriter(professionId: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PersistedState | null = null;

  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (typeof window !== "undefined")
      window.removeEventListener("pagehide", flush);
    if (!pending || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        storageKey(professionId),
        JSON.stringify(pending),
      );
    } catch {
      // Cota estourada ou storage bloqueado: o prototipo segue em memoria.
    }
    pending = null;
  };

  return {
    schedule(state: PersistedState) {
      pending = state;
      if (timer === null) {
        timer = setTimeout(flush, WRITE_DELAY_MS);
        // Recarregar logo apos salvar nao pode descartar a ultima escrita adiada.
        if (typeof window !== "undefined")
          window.addEventListener("pagehide", flush, { once: true });
      }
    },
    clear() {
      if (typeof window !== "undefined")
        window.removeEventListener("pagehide", flush);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(storageKey(professionId));
      } catch {
        // Nada a fazer: nao havia persistencia.
      }
    },
  };
}

