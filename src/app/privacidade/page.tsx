import type { Metadata } from "next";

import { LegalPage } from "@/components/layout/legal-page";
import { AI_ASSISTANT_NAME, APP_NAME } from "@/config/app";
import { CONTACT_EMAIL, OPERATOR_LEGAL_NAME } from "@/config/legal";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: `Como o ${APP_NAME} trata dados de quem usa o painel e de quem é atendido pelas organizações.`,
};

export default function PrivacidadePage() {
  return (
    <LegalPage
      title="Política de Privacidade"
      intro={`Como o ${APP_NAME} trata dados de quem usa o painel e de quem é atendido pelas organizações.`}
      otherHref="/termos"
      otherLabel="Termos de Uso"
    >
      <section className="space-y-3">
        <h2>1. A quem esta política se aplica</h2>
        <p>
          O {APP_NAME} é operado por <strong>{OPERATOR_LEGAL_NAME}</strong>,
          pessoa física. Esta política vale para duas situações: quem usa o painel
          (profissionais e suas equipes) e quem é atendido por uma organização que
          usa o {APP_NAME}.
        </p>
        <p>
          <strong>
            Se você é cliente ou paciente de um profissional que usa o {APP_NAME},
            procure primeiro esse profissional:
          </strong>{" "}
          é ele quem decide sobre os seus dados e quem consegue exportá-los ou
          eliminá-los. Nós tratamos esses dados em nome dele.
        </p>
      </section>

      <section className="space-y-3">
        <h2>2. Dados que tratamos</h2>
        <p>
          <strong>De quem usa o painel:</strong> nome, e-mail, senha guardada como
          resumo criptográfico, papel de acesso, profissão, registro no conselho e
          telefone quando informados, além de registros de segurança (segundo
          fator, tentativas de acesso e sinais do navegador que atestam o
          aplicativo).
        </p>
        <p>
          <strong>De quem é atendido:</strong> cadastro administrativo (nome, nome
          preferido, e-mail, telefone, observações administrativas, etiquetas e
          autorização de avisos por canal), horários da agenda, mensagens trocadas
          com a organização, decisões da {AI_ASSISTANT_NAME} sobre essas mensagens
          e lançamentos financeiros ligados ao atendimento.
        </p>
        <p>
          O {APP_NAME} não é prontuário e não foi feito para guardar dado clínico.
          Ainda assim, dependendo da profissão, o simples vínculo com a
          organização ou o conteúdo de uma mensagem pode revelar informação de
          saúde — por isso o acesso é restrito e registrado.
        </p>
      </section>

      <section className="space-y-3">
        <h2>3. Para que usamos</h2>
        <ul>
          <li>Criar e manter a conta e o acesso ao painel.</li>
          <li>
            Operar agenda, cadastro, mensagens e financeiro para a organização.
          </li>
          <li>Segurança: prevenir abuso e registrar quem fez o quê.</li>
          <li>
            Enviar avisos de atendimento, quando a organização ligar a função e a
            pessoa autorizar aquele canal.
          </li>
        </ul>
        <p>
          Não vendemos dados, não usamos dados de pessoas atendidas para
          publicidade e não os usamos para treinar modelos de inteligência
          artificial.
        </p>
      </section>

      <section className="space-y-3">
        <h2>4. Com quem compartilhamos</h2>
        <ul>
          <li>
            <strong>Google Cloud e Firebase</strong> — hospedagem, banco de dados,
            autenticação e funções. O banco e as funções ficam em São Paulo.
          </li>
          <li>
            <strong>Autoridades</strong>, quando a lei ou uma ordem judicial
            exigir.
          </li>
        </ul>
        <p>
          Nesta fase <strong>nenhum canal de mensagem está conectado</strong>, e
          não há cobrança pela plataforma. Quando o WhatsApp entrar, ele será
          informado aqui, porque a mensagem passa por empresa fora do Brasil.
        </p>
      </section>

      <section className="space-y-3">
        <h2>5. Por quanto tempo guardamos</h2>
        <ul>
          <li>Conta e acesso: enquanto a conta existir.</li>
          <li>
            Dados de quem é atendido: enquanto a organização existir, ou até um
            pedido de eliminação.
          </li>
          <li>Registros de acesso e de aplicação: 6 meses.</li>
          <li>Trilha de auditoria e decisões da assistente: de 3 a 5 anos.</li>
        </ul>
        <p>
          <strong>Nesta fase a exclusão por prazo ainda não é automática:</strong>{" "}
          ela é feita a pedido. Depois de uma eliminação, agenda, financeiro e
          trilha continuam existindo sem o que identifica a pessoa.
        </p>
      </section>

      <section className="space-y-3">
        <h2>6. Seus direitos</h2>
        <p>
          Você pode pedir confirmação de tratamento, acesso, correção,
          portabilidade, eliminação, informação sobre compartilhamento, revisão de
          decisão automatizada e retirada do consentimento.
        </p>
        <ul>
          <li>
            <strong>Se você é atendido por uma organização:</strong> peça a ela.
            Ela exporta e elimina os seus dados pela própria plataforma.
          </li>
          <li>
            <strong>Se você usa o painel:</strong> escreva para o contato abaixo.
          </li>
        </ul>
        <p>Respondemos em até 15 dias.</p>
      </section>

      <section className="space-y-3">
        <h2>7. Segurança</h2>
        <ul>
          <li>
            Isolamento entre organizações, verificado por regras no próprio banco.
          </li>
          <li>Quem opera a plataforma não lê dado de organização pelo painel.</li>
          <li>Segundo fator obrigatório para o acesso administrativo.</li>
          <li>Registro append-only dos atos administrativos.</li>
          <li>Cópia diária dos dados e recuperação a qualquer instante.</li>
          <li>Dados de cartão nunca passam por nossos sistemas.</li>
        </ul>
        <p>
          Nenhum sistema é imune a incidentes. Se acontecer um que afete dados de
          uma organização, avisaremos quem responde por ela.
        </p>
      </section>

      <section className="space-y-3">
        <h2>8. Cookies e o que fica no seu navegador</h2>
        <p>
          <strong>Não usamos cookies próprios</strong>, nem analytics, nem pixel,
          nem rastreador de publicidade. O que fica guardado no navegador:
        </p>
        <ul>
          <li>
            <strong>reCAPTCHA Enterprise, do Google:</strong> confirma que o
            acesso vem do nosso aplicativo, e não de um robô. Ele guarda um item
            no armazenamento local e é carregado em toda visita, inclusive nesta
            página. O Google pode definir cookies próprios dentro do quadro
            invisível dele, fora do nosso alcance.
          </li>
          <li>
            <strong>Sessão e atestado do aplicativo:</strong> mantêm você
            conectado ao painel.
          </li>
          <li>
            <strong>Preferências do painel:</strong> tema claro ou escuro e a
            profissão escolhida na demonstração.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2>9. Crianças e adolescentes</h2>
        <p>
          A conta do painel é sempre de um profissional adulto. Quando a pessoa
          atendida for menor de idade, quem autoriza os avisos é o responsável
          legal, e isso fica registrado.
        </p>
      </section>

      <section className="space-y-3">
        <h2>10. Contato e alterações</h2>
        <p>
          Pedidos sobre dados e dúvidas:{" "}
          <a
            className="underline underline-offset-2"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p>
          Mudanças relevantes serão avisadas com 30 dias de antecedência, e a
          versão no rodapé desta página muda junto.
        </p>
      </section>
    </LegalPage>
  );
}
