import Link from "next/link";
import type { Metadata } from "next";

import { APP_NAME } from "@/config/app";
import { CONTACT_EMAIL, OPERATOR_LEGAL_NAME } from "@/config/legal";

export const metadata: Metadata = {
  title: "Contato público",
  description: `Canal público do ${APP_NAME} para privacidade, recuperação de acesso e assuntos legais.`,
};

export default function ContactPage() {
  return (
    <div data-accent="violet" className="bg-background min-h-dvh">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-foreground text-sm font-semibold">{APP_NAME}</Link>
        <Link href="/termos" className="text-muted-foreground text-sm underline underline-offset-2">Termos de Uso</Link>
      </header>
      <main className="mx-auto w-full max-w-3xl px-6 pb-20">
        <h1 className="text-foreground text-2xl font-semibold">Contato público</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Este canal é exclusivo para privacidade, assuntos legais e recuperação de acesso. O suporte operacional é feito dentro do painel para pessoas com conta.
        </p>
        <section className="border-border bg-surface mt-8 rounded-xl border p-5 text-sm leading-relaxed">
          <h2 className="text-foreground font-semibold">Como falar com a gente</h2>
          <p className="text-muted-foreground mt-2">
            Escreva para <a className="underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Resposta em até 2 dias úteis.
          </p>
          <p className="text-muted-foreground mt-2">O {APP_NAME} é operado por {OPERATOR_LEGAL_NAME}. Nunca envie senha, código autenticador ou dados de saúde.</p>
        </section>
      </main>
    </div>
  );
}
