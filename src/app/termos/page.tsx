import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage } from "@/components/layout/legal-page";
import { AI_ASSISTANT_NAME, APP_NAME } from "@/config/app";
import { CONTACT_EMAIL, OPERATOR_LEGAL_NAME } from "@/config/legal";
import { BLOCKED_RETENTION_DAYS, TRIAL_DAYS } from "@/config/platform";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: `Condições de uso do ${APP_NAME} por quem assina e por quem a organização autoriza.`,
};

const LINK_CLASSES = "underline underline-offset-2";

export default function TermosPage() {
  return (
    <LegalPage
      title="Termos de Uso"
      intro={`Condições de uso do ${APP_NAME} por quem assina e por quem a organização autoriza a usar o painel.`}
      otherHref="/privacidade"
      otherLabel="Política de Privacidade"
    >
      <section className="space-y-3">
        <h2>1. Quem oferece e o que é o {APP_NAME}</h2>
        <p>
          O {APP_NAME} é oferecido por <strong>{OPERATOR_LEGAL_NAME}</strong>,
          pessoa física, que ainda não tem empresa constituída. Quando houver
          empresa, esta cláusula passa a trazer razão social, CNPJ e endereço, e
          você será avisado.
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
        <h2>2. Licença de uso com manutenção</h2>
        <p>
          Quem assina recebe uma <strong>licença de uso</strong> do {APP_NAME}:
          pessoal, não exclusiva e intransferível, válida enquanto durar o teste
          ou a assinatura. Não há venda nem cessão do sistema. O código, a marca e
          a infraestrutura continuam sendo de {OPERATOR_LEGAL_NAME}.
        </p>
        <p>
          Todas as organizações usam a mesma plataforma, cada uma isolada das
          outras. A manutenção inclui correções e melhorias, aplicadas a todas ao
          mesmo tempo.
        </p>
        <p>
          Para quem responde pela organização, o{" "}
          <Link href="/contrato" className={LINK_CLASSES}>
            Contrato de Licença e o Anexo de Tratamento de Dados
          </Link>{" "}
          detalham estas condições e fazem parte destes Termos.
        </p>
      </section>

      <section className="space-y-3">
        <h2>3. Cadastro, teste e acesso</h2>
        <ul>
          <li>
            A conta pode ser criada pelo próprio profissional, no cadastro do
            site, ou por nós, a convite. Na conta criada por nós, a senha inicial
            é temporária e deve ser trocada no primeiro acesso.
          </li>
          <li>
            O cadastro pelo site abre um <strong>teste de {TRIAL_DAYS} dias</strong>,
            sem cartão. Terminado o teste sem assinatura, o painel fecha. Por{" "}
            {BLOCKED_RETENTION_DAYS} dias ainda é possível assinar, exportar os
            dados ou excluir a organização. Depois disso, os dados são
            pseudonimizados, de modo a não identificar mais ninguém.
          </li>
          <li>
            <strong>Nesta fase não há cobrança real pela plataforma.</strong>{" "}
            Quando houver, os planos e as condições serão apresentados antes, e
            ninguém passa a pagar sem contratar.
          </li>
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
        <h2>4. Suporte</h2>
        <p>
          O suporte cobre <strong>defeitos do {APP_NAME}</strong>: algo que o
          sistema deveria fazer e não faz. Ele é prestado pelos chamados do painel,
          em dias úteis, sem prazo garantido nesta fase. Quem perdeu o acesso ao
          painel usa a página de contato.
        </p>
        <p>
          O suporte não cobre orientação clínica, jurídica, fiscal ou contábil,
          nem a configuração de contas e serviços que pertencem à organização,
          como a conta do WhatsApp, o certificado digital ou o meio de recebimento
          dela.
        </p>
        <p>
          Não há garantia de funcionamento ininterrupto. Falhas e interrupções
          podem acontecer, e avisaremos o que for relevante.
        </p>
      </section>

      <section className="space-y-3">
        <h2>5. Os dados das pessoas atendidas são da organização</h2>
        <p>
          Cada assinante opera uma organização. Os dados das pessoas atendidas
          pertencem a ela: nenhuma outra organização os alcança, e a operação do{" "}
          {APP_NAME} não os lê pelo painel.
        </p>
        <p>
          Pela Lei Geral de Proteção de Dados, a organização é a{" "}
          <strong>controladora</strong> desses dados, e o {APP_NAME} é o{" "}
          <strong>operador</strong>: trata os dados em nome dela e segundo as
          instruções dela, como descrito no Anexo de Tratamento de Dados.
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
        <h2>6. A assistente responde só o administrativo</h2>
        <p>
          A {AI_ASSISTANT_NAME} responde automaticamente apenas mensagens
          classificadas como administrativas, como horário, valor e endereço.
          Qualquer outra — inclusive qualquer sinal de risco — é encaminhada ao
          profissional, com alerta. Quem assina é responsável pelas regras que
          cria e pelas respostas enviadas em seu nome.
        </p>
      </section>

      <section className="space-y-3">
        <h2>7. Avisos às pessoas atendidas</h2>
        <p>
          Nenhum aviso sai sozinho. É preciso ligar a função, escolher evento e
          canal, comprovar o remetente e ter o consentimento da pessoa para aquele
          canal. <strong>Nesta fase nenhum canal real está conectado:</strong> os
          envios são simulados.
        </p>
      </section>

      <section className="space-y-3">
        <h2>8. Integrações em nome da organização</h2>
        <p>
          Algumas funções usam contas que são da organização, e não do{" "}
          {APP_NAME}: a agenda do Google do profissional, o número de WhatsApp e,
          no futuro, o certificado digital para emitir nota fiscal. Essas contas
          ficam em nome da organização ou do próprio profissional e só são usadas
          depois que quem responde por elas as conecta e autoriza.
        </p>
        <p>
          O {APP_NAME} nunca usa o CPF ou o CNPJ da organização para obrigações
          próprias.
        </p>
      </section>

      <section className="space-y-3">
        <h2>9. Obrigações fiscais e profissionais</h2>
        <p>
          Recibos, cobranças e o financeiro do painel são registros
          administrativos da organização. Eles não substituem nota fiscal nem o
          recibo da Receita Saúde. Emitir os documentos fiscais e cumprir as
          obrigações tributárias e do conselho profissional cabe à organização.
        </p>
      </section>

      <section className="space-y-3">
        <h2>10. Exportar, excluir e sair</h2>
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
        <h2>11. Uso aceitável</h2>
        <p>
          É proibido usar a plataforma para fins ilícitos, enviar mensagens não
          autorizadas, tentar alcançar dados de outra organização, contornar
          limites de segurança, inserir conteúdo que viole direito de terceiros,
          copiar ou desmontar o sistema ou revender o acesso.
        </p>
      </section>

      <section className="space-y-3">
        <h2>12. Responsabilidade</h2>
        <p>
          Quem assina responde pelo conteúdo que insere e pelas decisões
          profissionais que toma. O {APP_NAME} é ferramenta de apoio: não decide
          atendimento, não orienta conduta e não responde por escolha profissional.
        </p>
      </section>

      <section className="space-y-3">
        <h2>13. Alterações</h2>
        <p>
          Mudanças relevantes nestes Termos serão avisadas com 30 dias de
          antecedência, pelo painel e por e-mail.
        </p>
      </section>

      <section className="space-y-3">
        <h2>14. Lei, foro e contato</h2>
        <p>
          Aplica-se a lei brasileira, no foro do domicílio de quem assina quando a
          relação for de consumo.
        </p>
        <p>
          Contato: <a className={LINK_CLASSES} href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
