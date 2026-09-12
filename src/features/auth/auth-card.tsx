import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { APP_NAME, APP_TAGLINE, OPERATOR_NAME } from "@/config/app";

/** Moldura das telas fora do painel: entrar, pedir e criar nova senha. */
export function AuthCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      data-accent="violet"
      className="bg-background flex min-h-dvh items-center justify-center px-6 py-12"
    >
      <main className="w-full max-w-sm">
        <div className="flex items-center gap-2.5">
          <span className="bg-accent text-accent-foreground flex size-9 items-center justify-center rounded-lg">
            <Sparkles className="size-4.5" aria-hidden strokeWidth={2} />
          </span>
          <div>
            <p className="text-foreground text-sm font-semibold">{APP_NAME}</p>
            <p className="text-muted-foreground text-xs">{APP_TAGLINE}</p>
          </div>
        </div>

        <h1 className="text-foreground mt-8 text-lg font-semibold tracking-tight">
          {title}
        </h1>

        {children}

        <p className="text-muted-foreground mt-6 text-center text-xs">
          <Link href="/" className="underline underline-offset-2">
            Voltar para a apresentação
          </Link>
        </p>
        <p className="text-muted-foreground mt-2 text-center text-xs">
          {APP_NAME} é uma plataforma {OPERATOR_NAME}.
        </p>
      </main>
    </div>
  );
}

export const AUTH_FIELD_CLASSES =
  "h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground placeholder:text-subtle-foreground transition-colors focus:border-primary";
