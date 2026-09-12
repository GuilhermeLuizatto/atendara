"use client";

import { useEffect } from "react";

/**
 * Ultima rede, quando o proprio layout raiz falha. Substitui o documento
 * inteiro e nao recebe o CSS global, por isso o estilo e embutido e usa o
 * esquema de cores do sistema.
 */
export default function GlobalError({
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
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          colorScheme: "light dark",
          padding: "1.5rem",
        }}
      >
        <main role="alert" style={{ maxWidth: "28rem", textAlign: "center" }}>
          <title>Erro · Nexo</title>
          <h1 style={{ fontSize: "1.25rem" }}>O Nexo encontrou um erro</h1>
          <p style={{ lineHeight: 1.6 }}>
            Nada foi apagado. Tente de novo; se continuar, recarregue a página.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ padding: "0.6rem 1rem", fontSize: "1rem", cursor: "pointer" }}
          >
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
