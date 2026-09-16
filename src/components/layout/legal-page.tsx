import Link from "next/link";
import type { ReactNode } from "react";

import { APP_NAME } from "@/config/app";
import { LEGAL_UPDATED_AT, LEGAL_VERSION } from "@/config/legal";

/**
 * Moldura das paginas publicas de texto legal.
 *
 * O selo de versao preliminar fica no topo, e nao no rodape: quem abre a
 * pagina precisa saber antes de ler que o texto ainda nao passou por advogado.
 */
export function LegalPage({
  title,
  intro,
  otherHref,
  otherLabel,
  children,
}: {
  title: string;
  intro: string;
  otherHref: "/termos" | "/privacidade";
  otherLabel: string;
  children: ReactNode;
}) {
  return (
    <div data-accent="violet" className="bg-background min-h-dvh">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-foreground text-sm font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        <Link href={otherHref} className="text-muted-foreground text-sm underline underline-offset-2">
          {otherLabel}
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 pb-20">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">{intro}</p>

        <p className="bg-warning-soft text-warning-soft-foreground mt-6 rounded-lg px-4 py-3 text-sm">
          <strong className="font-semibold">Versão preliminar.</strong> Este texto
          foi escrito a partir do que o sistema faz hoje e ainda não passou por
          revisão de advogado. Ele descreve um piloto fechado, gratuito e por
          convite. Quando a revisão acontecer, o texto e a versão mudam.
        </p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed [&_h2]:text-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:text-muted-foreground [&_p]:text-muted-foreground [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>

        <footer className="border-border text-muted-foreground mt-12 border-t pt-6 text-xs">
          Versão {LEGAL_VERSION} · atualizada em {LEGAL_UPDATED_AT}.
        </footer>
      </main>
    </div>
  );
}
