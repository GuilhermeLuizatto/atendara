import type { Metadata } from "next";

import { LegalPage } from "@/components/layout/legal-page";
import { AI_ASSISTANT_NAME, APP_NAME } from "@/config/app";
import { CONTACT_EMAIL, OPERATOR_LEGAL_NAME } from "@/config/legal";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: `Condições de uso do ${APP_NAME} durante o piloto fechado.`,
};

export default function TermosPage() {
  return (
    <LegalPage
      title="Termos de Uso"
      intro={`Condições de uso do ${APP_NAME} por quem assina e por quem a organização autoriza a usar o painel.`}
      otherHref="/privacidade"
      otherLabel="Política de Privacidade"
    >
      <section className="space-y-3">
        <h2>1. Quem opera e o que é o {APP_NAME}</h2>
        <p>
          O {APP_NAME} é operado por <strong>{OPERATOR_LEGAL_NAME}</strong>,
          pessoa física. Quando houver empresa constituída, esta cláusula passa a
          trazer razão social, CNPJ e endereço.
        </p>
        <p>
          O {APP_NAME} é uma plataforma de apoio administrativo: agenda, cadastro
          de clientes, financeiro do negócio, caixa de entrada de mensagens e{" "}
          {AI_ASSISTANT_NAME}, uma assistente que responde apenas assuntos
          administrativos.
        </p>
        <p>
          <strong>
            O {APP_NAME} não é prontuário, não faz diagnóstico, não substitui o
            julgamento do profissional e não é serviço de emergência.
          </strong>
        </p>
      </section>

      <section className="space-y-3">
        <h2>2. Piloto fechado e gratuito</h2>
        <p>
          Nesta fase o uso é <strong>gratuito e por convite</strong>. Não há
          cobrança pela plataforma, e o acesso é liberado por prazo determinado,
          renovável. Quando a cobrança existir, os planos e as condições serão
          apresentados antes, e ninguém passa a pagar sem contratar.
        </p>
        <p>
          Por ser um piloto, não há garantia de funcionamento ininterrupto. Falhas
          e interrupções podem acontecer, e avisaremos o que for relevante.
        </p>
      </section>

      <section className="space-y-3">
        <h2>3. Conta e acesso</h2>
        <ul>
          <li>As contas são criadas por nós e entregues a quem foi convidado.</li>
          <li>A senha inicial é temporária e deve ser trocada no primeiro acesso.</li>
          <li>
            Quem assina responde pelo sigilo das credenciais da sua equipe e pelos
            atos praticados com elas.
          </li>
          <li>
            O acesso pode ser suspenso em caso de uso indevido ou risco à
            segurança.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2>4. Os dados das pessoas atendidas são da organização</h2>
        <p>
          Cada assinante opera uma organização. Os dados das pessoas atendidas
          pertencem ao contexto dessa organização: nenhuma outra organização os
          alcança, e a operação do {APP_NAME} não os lê pelo painel.
        </p>
        <p>
          Cabe a quem assina: ter base legal para tratar esses dados; registrar o
          consentimento para avisos, quando houver; não escrever dado clínico nos
          campos administrativos; atender os pedidos das pessoas atendidas usando
          as ferramentas da plataforma; e cumprir os deveres da sua profissão e do
          seu conselho.
        </p>
      </section>

      <section className="space-y-3">
        <h2>5. A assistente responde só o administrativo</h2>
        <p>
          A {AI_ASSISTANT_NAME} responde automaticamente apenas mensagens
          classificadas como administrativas, como horário, valor e endereço.
          Qualquer outra — inclusive qualquer sinal de risco — é encaminhada ao
          profissional, com alerta. Quem assina é responsável pelas regras que
          cria e pelas respostas enviadas em seu nome.
        </p>
      </section>

      <section className="space-y-3">
        <h2>6. Avisos às pessoas atendidas</h2>
        <p>
          Nenhum aviso sai sozinho. É preciso ligar a função, escolher evento e
          canal, comprovar o remetente e ter o consentimento da pessoa para aquele
          canal. <strong>Nesta fase nenhum canal real está conectado:</strong> os
          envios são simulados.
        </p>
      </section>

      <section className="space-y-3">
        <h2>7. Exportar e excluir</h2>
        <p>
          Quem responde pela organização pode exportar os dados de uma pessoa
          atendida, eliminá-los a pedido dela e exportar os dados da organização
          inteira. O titular da conta pode excluir a organização. A exclusão é
          irreversível.
        </p>
        <p>
          Registros de auditoria e decisões da assistente permanecem sem o que
          identifica a pessoa, pelo prazo descrito na Política de Privacidade.
        </p>
      </section>

      <section className="space-y-3">
        <h2>8. Uso aceitável</h2>
        <p>
          É proibido usar a plataforma para fins ilícitos, enviar mensagens não
          autorizadas, tentar alcançar dados de outra organização, contornar
          limites de segurança, inserir conteúdo que viole direito de terceiros ou
          revender o acesso.
        </p>
      </section>

      <section className="space-y-3">
        <h2>9. Responsabilidade</h2>
        <p>
          Quem assina responde pelo conteúdo que insere e pelas decisões
          profissionais que toma. O {APP_NAME} é ferramenta de apoio: não decide
          atendimento, não orienta conduta e não responde por escolha profissional.
        </p>
      </section>

      <section className="space-y-3">
        <h2>10. Alterações</h2>
        <p>
          Mudanças relevantes nestes Termos serão avisadas com 30 dias de
          antecedência, pelo painel e por e-mail.
        </p>
      </section>

      <section className="space-y-3">
        <h2>11. Lei, foro e contato</h2>
        <p>
          Aplica-se a lei brasileira, no foro do domicílio de quem assina quando a
          relação for de consumo.
        </p>
        <p>
          Contato: <a className="underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
