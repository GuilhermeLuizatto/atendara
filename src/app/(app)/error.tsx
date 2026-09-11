"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button, buttonStyles } from "@/components/ui/button";

/**
 * Erro de renderizacao dentro do painel. O menu continua de pe (a borda fica
 * abaixo do layout), entao a pessoa sai por ali ou tenta a mesma tela de novo.
 * A mensagem tecnica vai para o console; na tela, so o que ela pode fazer.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section
      role="alert"
      aria-labelledby="app-error-title"
      className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center"
    >
      <span className="bg-danger-soft text-danger-soft-foreground flex size-12 items-center justify-center rounded-full">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <h1 id="app-error-title" className="text-foreground text-xl font-semibold">
        Esta tela encontrou um erro
      </h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        Nada foi apagado. Tente abrir a tela de novo; se o erro continuar,
        recarregue a pagina.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>Tentar de novo</Button>
        <Link href="/dashboard" className={buttonStyles({ variant: "outline" })}>
          Voltar ao inicio
        </Link>
      </div>
    </section>
  );
}
