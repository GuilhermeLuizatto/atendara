"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import {
  AI_ASSISTANT_NAME,
  APP_DESCRIPTION,
  APP_NAME,
  OPERATOR_NAME,
  APP_TAGLINE,
} from "@/config/app";
import { listProfessions } from "@/config/professions";

const PILLARS = [
  {
    icon: CalendarDays,
    title: "Agenda e CRM",
    body: "Atendimentos, cadastro e relacionamento em uma base única, adaptada ao vocabulário de cada profissão.",
  },
  {
    icon: Bot,
    title: `${AI_ASSISTANT_NAME}, sua assistente de IA`,
    body: "Responde o administrativo dentro de regras que você define, e encaminha tudo o mais para você.",
  },
  {
    icon: ShieldCheck,
    title: "Decisões rastreáveis",
    body: "Cada resposta automática registra classificação, confiança, regras aplicadas e motivo.",
  },
  {
    icon: Users,
    title: "Do autônomo à clínica",
    body: "Isolamento por organização e papéis de acesso desde a fundação, não como remendo depois.",
  },
];

export default function LandingPage() {
  return (
    <div data-accent="violet" className="bg-background min-h-dvh">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <span className="text-foreground text-sm font-semibold tracking-tight">
          {APP_NAME}
        </span>
        <Link href="/login" className={buttonStyles({ variant: "secondary", size: "sm" })}>
          Entrar
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 pb-20">
        <section className="py-12 sm:py-20">
          <Badge tone="accent" dot>
            Protótipo navegável
          </Badge>
          <h1 className="text-foreground mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {APP_TAGLINE}
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl text-sm leading-relaxed sm:text-base">
            {APP_DESCRIPTION}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/dashboard" className={buttonStyles({ size: "lg" })}>
              Abrir o painel
              <ArrowRight className="size-4" aria-hidden strokeWidth={2} />
            </Link>
            <p className="text-muted-foreground text-xs">
              Dados fictícios. Nenhuma informação real é usada.
            </p>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-card border-border bg-surface shadow-card border p-5"
            >
              <span className="bg-accent-soft text-accent flex size-9 items-center justify-center rounded-lg">
                <Icon className="size-4.5" aria-hidden strokeWidth={1.75} />
              </span>
              <h2 className="text-foreground mt-4 text-sm font-semibold">
                {title}
              </h2>
              <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                {body}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-12">
          <h2 className="text-foreground text-sm font-semibold">
            Uma plataforma, várias profissões
          </h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            O núcleo não conhece profissão. Terminologia, taxonomia de mensagens
            e regras vêm de configuração.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {listProfessions().map((profession) => (
              <li key={profession.id} data-accent={profession.accent}>
                <span className="border-border bg-surface text-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium">
                  <span
                    aria-hidden
                    className="bg-accent size-1.5 rounded-full"
                  />
                  {profession.label}
                  <span className="text-muted-foreground">
                    {profession.terminology.client.pluralLower}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="border-border text-muted-foreground mt-12 border-t pt-6 text-xs">
          {APP_NAME} é uma plataforma {OPERATOR_NAME}.
        </footer>
      </main>
    </div>
  );
}
