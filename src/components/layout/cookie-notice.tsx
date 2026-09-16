"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { createPreferenceStore } from "@/lib/storage/preference-store";

/**
 * Aviso de cookies.
 *
 * O site nao grava cookie proprio e nao tem rastreador: o unico terceiro e o
 * reCAPTCHA, que atesta o aplicativo. Por isso o aviso INFORMA em vez de pedir
 * escolha — nao ha o que recusar sem derrubar a protecao contra robo.
 *
 * A marca de "ja li" vive no navegador de quem visita, como as demais
 * preferencias, por `useSyncExternalStore`: ler `localStorage` no render
 * quebraria a hidratacao.
 */

const noticeStore = createPreferenceStore<boolean>(
  "atendara:aviso-cookies",
  false,
  (raw) => (raw === "lido" ? true : null),
  (value) => (value ? "lido" : "nao-lido"),
);

export function CookieNotice() {
  const read = useSyncExternalStore(
    noticeStore.subscribe,
    noticeStore.getSnapshot,
    noticeStore.getServerSnapshot,
  );

  if (read) return null;

  return (
    <aside
      aria-label="Aviso sobre cookies"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
    >
      <div className="bg-surface border-border shadow-overlay mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:gap-4">
        <p className="text-muted-foreground text-sm">
          Este site não usa cookies de publicidade nem rastreadores. Para
          confirmar que o acesso vem do aplicativo, carregamos o reCAPTCHA do
          Google, que guarda um item no seu navegador. Detalhes na{" "}
          <Link
            href="/privacidade"
            className="text-foreground underline underline-offset-2"
          >
            Política de Privacidade
          </Link>
          .
        </p>
        <Button
          size="sm"
          className="sm:shrink-0"
          onClick={() => noticeStore.set(true)}
        >
          Entendi
        </Button>
      </div>
    </aside>
  );
}
