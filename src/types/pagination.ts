/**
 * Pagina de uma listagem lida por cursor.
 *
 * O cursor e opaco de proposito: no Firestore ele e o ultimo documento lido, e o
 * dominio nao importa `firebase/*`. Quem pede a proxima pagina devolve o cursor
 * exatamente como recebeu.
 */
declare const pageCursorBrand: unique symbol;

export type PageCursor = { readonly [pageCursorBrand]: true };

export interface PageRequest {
  cursor?: PageCursor | null;
  size?: number;
}

export interface Page<T> {
  items: T[];
  /** `null` quando nao ha proxima pagina. */
  next: PageCursor | null;
}
