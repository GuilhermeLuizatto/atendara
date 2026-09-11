"use client";

import { useCallback, useEffect, useState } from "react";

import type { Page, PageCursor, PageRequest } from "@/types";

/**
 * Lista administrativa lida por paginas.
 *
 * O estado distingue "carregando" de "vazio" de proposito: antes, a lista de
 * cadastros dizia "Nenhum profissional cadastrado" enquanto a primeira leitura
 * ainda estava a caminho.
 *
 * `fetchPage` precisa ter identidade estavel (`useCallback`); trocar a funcao
 * recomeca a lista da primeira pagina.
 */
export function usePagedList<T>(
  fetchPage: (request: PageRequest) => Promise<Page<T>>,
  errorMessage: string,
) {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<PageCursor | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(
    () =>
      fetchPage({})
        .then((page) => {
          setItems(page.items);
          setNext(page.next);
          setStatus("ready");
          setError("");
        })
        .catch(() => {
          setStatus("error");
          setError(errorMessage);
        }),
    [fetchPage, errorMessage],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage({ cursor: next });
      setItems((current) => [...current, ...page.items]);
      setNext(page.next);
    } catch {
      setError(errorMessage);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, next, errorMessage]);

  return {
    items,
    setItems,
    status,
    error,
    reload,
    loadMore,
    page: { hasMore: next !== null, loading: loadingMore },
  };
}
