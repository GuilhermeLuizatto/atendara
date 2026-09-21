import Link from "next/link";
import type { Metadata } from "next";

import { APP_NAME } from "@/config/app";
import { CONTACT_EMAIL, OPERATOR_LEGAL_NAME } from "@/config/legal";

export const metadata: Metadata = {
  title: "Suporte",
  description: `Como falar com o suporte do ${APP_NAME} e como pedir acesso, correção ou eliminação de dados pessoais.`,
};

/**
 * Endereco publico de atendimento.
 *
 * Existe por tres motivos que apontam para o mesmo lugar: o campo "URL de
 * atendimento ao cliente" da Stripe, o canal de titular de dados exigido pela
 * LGPD e o link de ajuda do painel. Nao reusa a moldura de `LegalPage` de
 * proposito — aquela carrega o selo de texto preliminar, que aqui enganaria.
 */
export default function SuportePage() {
  return (
    <div data-accent="violet" className="bg-background min-h-dvh">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-foreground text-sm font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        <Link href="/termos" className="text-muted-foreground text-sm underline underline-offset-2">
          Termos de Uso
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 pb-20">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">
          Suporte
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Um canal único para dúvidas sobre o {APP_NAME}, problemas no painel e
          pedidos sobre dados pessoais.
        </p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed [&_h2]:text-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:text-muted-foreground [&_p]:text-muted-foreground [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          <section className="space-y-3">
            <h2>Como falar com a gente</h2>
            <p>
              Escreva para{" "}
              <a className="underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              . Respondo em até 2 dias úteis.
            </p>
            <p>
              O {APP_NAME} é operado por <strong>{OPERATOR_LEGAL_NAME}</strong>,
              pessoa física. Não há atendimento por telefone nem por WhatsApp.
            </p>
          </section>

          <section className="space-y-3">
            <h2>O que ajuda a resolver mais rápido</h2>
            <ul>
              <li>O e-mail com que você entra no painel.</li>
              <li>O nome da organização.</li>
              <li>A tela onde o problema aconteceu e o que você esperava que acontecesse.</li>
              <li>Data e hora aproximadas.</li>
            </ul>
            <p>
              <strong>
                Nunca envie senha, código do aplicativo autenticador ou dado de
                saúde de quem você atende.
              </strong>{" "}
              Nada disso é necessário para o atendimento, e o suporte não lê os
              dados da sua organização pelo painel.
            </p>
          </section>

          <section className="space-y-3">
            <h2>Pedidos sobre dados pessoais</h2>
            <p>
              Se você assina o {APP_NAME}, escreva para o mesmo endereço para
              pedir acesso, correção, portabilidade ou eliminação dos seus dados
              de cadastro.
            </p>
            <p>
              <strong>
                Se você é atendido por um profissional que usa o {APP_NAME}, o
                pedido deve ir para ele.
              </strong>{" "}
              Os dados de quem é atendido pertencem ao contexto daquela
              organização — é ela quem decide o que é tratado e por quê, e é ela
              quem exporta e elimina, com as ferramentas do painel.
            </p>
          </section>

          <section className="space-y-3">
            <h2>Em que fase o produto está</h2>
            <p>
              O {APP_NAME} está em <strong>piloto fechado</strong>. Falhas e
              interrupções podem acontecer, e avisamos o que for relevante. As
              condições completas estão nos{" "}
              <Link className="underline underline-offset-2" href="/termos">
                Termos de Uso
              </Link>{" "}
              e na{" "}
              <Link className="underline underline-offset-2" href="/privacidade">
                Política de Privacidade
              </Link>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
