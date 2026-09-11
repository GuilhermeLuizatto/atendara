import {
  getDocs,
  limit,
  query,
  startAfter,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import type { Page, PageCursor, PageRequest } from "@/types/pagination";

/**
 * Le uma pagina de uma consulta ja ordenada.
 *
 * Pede um documento a mais do que mostra: e o que diz se existe proxima pagina
 * sem uma segunda ida ao servidor so para descobrir que nao havia.
 */
export async function readPage<T>(
  base: Query,
  request: PageRequest,
  defaultSize: number,
  map: (document: QueryDocumentSnapshot) => T,
): Promise<Page<T>> {
  const size = request.size ?? defaultSize;
  const constraints: QueryConstraint[] = [];
  if (request.cursor) {
    constraints.push(startAfter(request.cursor as unknown as QueryDocumentSnapshot));
  }
  constraints.push(limit(size + 1));

  const result = await getDocs(query(base, ...constraints));
  const documents = result.docs.slice(0, size);
  return {
    items: documents.map(map),
    next:
      result.docs.length > size
        ? (documents[documents.length - 1] as unknown as PageCursor)
        : null,
  };
}
