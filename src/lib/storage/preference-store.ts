/**
 * Store externo minimo sobre o `localStorage`, para uso com
 * `useSyncExternalStore`.
 *
 * Por que nao `useState` + `useEffect`: ler o `localStorage` durante o render
 * quebra a hidratacao (o servidor nao tem storage), e corrigir isso com um
 * efeito que chama `setState` provoca render em cascata — exatamente o que a
 * regra `react-hooks/set-state-in-effect` proibe.
 *
 * `useSyncExternalStore` resolve os dois: entrega o valor do servidor durante a
 * hidratacao e troca para o valor real logo depois, sem efeito nenhum.
 */

export interface PreferenceStore<T> {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  read: () => T;
  set: (value: T) => void;
}

export function createPreferenceStore<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | null,
  serialize: (value: T) => string = String,
): PreferenceStore<T> {
  const listeners = new Set<() => void>();

  // `getSnapshot` precisa devolver a MESMA referencia enquanto nada mudar, ou
  // o React entra em loop de re-render. Por isso o valor fica em cache.
  let cache: T = fallback;
  let loaded = false;

  function readFromStorage(): T {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      return parse(raw) ?? fallback;
    } catch {
      // Storage bloqueado (janela privada, politica do navegador).
      return fallback;
    }
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function invalidate(): void {
    loaded = false;
    notify();
  }

  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);

      // Sincroniza entre abas: outra aba do painel muda o tema ou a profissao.
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) invalidate();
      };
      if (typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
      }

      return () => {
        listeners.delete(onStoreChange);
        if (typeof window !== "undefined") {
          window.removeEventListener("storage", onStorage);
        }
      };
    },

    getSnapshot() {
      if (!loaded) {
        cache = readFromStorage();
        loaded = true;
      }
      return cache;
    },

    getServerSnapshot() {
      return fallback;
    },

    read: readFromStorage,

    set(value: T) {
      cache = value;
      loaded = true;
      try {
        window.localStorage.setItem(key, serialize(value));
      } catch {
        // Sem persistencia: o valor vale apenas para esta sessao.
      }
      notify();
    },
  };
}

/** Assinatura inerte: o valor nunca muda depois da hidratacao. */
const noopSubscribe = () => () => {};

/**
 * `false` durante o prerender e no primeiro render do cliente, `true` logo apos
 * a hidratacao. Serve para adiar trabalho que so faz sentido no navegador — por
 * exemplo montar dados ancorados na data atual.
 */
export const hydrationStore = {
  subscribe: noopSubscribe,
  getSnapshot: () => true,
  getServerSnapshot: () => false,
};
