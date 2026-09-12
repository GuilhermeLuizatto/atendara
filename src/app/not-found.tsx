import Link from "next/link";

import { buttonStyles } from "@/components/ui/button";
import { APP_NAME } from "@/config/app";

export const metadata = { title: "Página não encontrada" };

/** Endereco que nao existe, digitado ou vindo de um link antigo. */
export default function NotFound() {
  return (
    <main className="bg-background flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-muted-foreground text-sm font-medium">{APP_NAME}</p>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Página não encontrada
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          O endereço pode ter sido digitado errado ou a página mudou de lugar.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/dashboard" className={buttonStyles()}>
            Abrir o painel
          </Link>
          <Link href="/" className={buttonStyles({ variant: "outline" })}>
            Página inicial
          </Link>
        </div>
      </div>
    </main>
  );
}
