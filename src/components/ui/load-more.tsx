import { cn } from "@/lib/utils/cn";

import { Button } from "./button";

/**
 * Rodape de lista paginada.
 *
 * Diz quanto esta na tela e o que ficou de fora antes de oferecer o botao:
 * uma lista cortada sem aviso faz a busca "nao encontrar" o que so nao foi
 * carregado.
 */
export function LoadMore({
  page,
  summary,
  label = "Carregar mais",
  onLoadMore,
  className,
}: {
  page: { hasMore: boolean; loading: boolean } | undefined;
  /** Ex.: "Mostrando os 500 lancamentos mais recentes." */
  summary: string;
  label?: string;
  onLoadMore: () => void;
  className?: string;
}) {
  if (!page?.hasMore && !page?.loading) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-4 py-3",
        className,
      )}
    >
      <p className="text-muted-foreground text-xs" role="status">
        {page.loading ? "Carregando mais registros..." : summary}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={onLoadMore}
        disabled={page.loading}
        aria-busy={page.loading || undefined}
      >
        {page.loading ? "Carregando..." : label}
      </Button>
    </div>
  );
}
