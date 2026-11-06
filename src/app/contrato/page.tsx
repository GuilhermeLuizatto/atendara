import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { LegalPage } from "@/components/layout/legal-page";
import { APP_NAME } from "@/config/app";
import {
  CONTACT_EMAIL,
  CONTRACT_UPDATED_AT,
  CONTRACT_VERSION,
  OPERATOR_LEGAL_NAME,
  SUBPROCESSORS,
  SUBPROCESSOR_LOCATION_LABEL,
} from "@/config/legal";
import { BLOCKED_RETENTION_DAYS, TRIAL_DAYS } from "@/config/platform";

export const metadata: Metadata = {
  title: "Contrato de Licença e Tratamento de Dados",
  description: `Contrato de licença de uso do ${APP_NAME} e anexo de tratamento de dados pessoais, em que o ${APP_NAME} é operador.`,
};

const LINK_CLASSES = "underline underline-offset-2";

/** Lista os servicos que tiram dado do Brasil, a partir da lista unica. */
function abroadNames(): string {
  const names = SUBPROCESSORS.filter((item) => item.location !== "BRAZIL").map((item) => item.name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : (names[0] ?? "");
}

function Clause({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-foreground font-semibold">{title}</h3>
      {children}
    </div>
  );
}

export default function ContratoPage() {
  return (
    <LegalPage
      title="Contrato de Licença e Anexo de Tratamento de Dados"
      intro={`Condições entre o ${APP_NAME} e a organização que o usa, aceitas por quem responde por ela.`}
      otherHref="/termos"
      otherLabel="Termos de Uso"
      version={CONTRACT_VERSION}
      updatedAt={CONTRACT_UPDATED_AT}
    >
      <section className="space-y-4" aria-labelledby="contrato-licenca">
        <h2 id="contrato-licenca">Parte 1 — Contrato de Licença de Uso</h2>

        <Clause title="1.1. Partes">
          <p>
            <strong>Licenciante:</strong> {OPERATOR_LEGAL_NAME}, pessoa física,
            responsável pelo {APP_NAME}. Quando houver empresa constituída, ela
            assume este contrato, e a organização será avisada.
          </p>
          <p>
            <strong>Licenciada:</strong> a organização identificada no cadastro,
            com o CPF ou o CNPJ dela, representada por quem é titular da conta.
          </p>
        </Clause>

        <Clause title="1.2. Objeto">
          <p>
            Licença de uso do {APP_NAME}, com manutenção: pessoal, não exclusiva e
            intransferível, enquanto durar o teste ou a assinatura. O código, a
            marca e a infraestrutura continuam sendo do licenciante. Todas as
            organizações usam a mesma plataforma, isoladas umas das outras, e
            recebem as mesmas correções e melhorias.
          </p>
        </Clause>

        <Clause title="1.3. Suporte">
          <p>
            Cobre defeitos do aplicativo, pelos chamados do painel, em dias úteis,
            sem prazo garantido nesta fase. Não cobre
            orientação clínica, jurídica, fiscal ou contábil, nem a configuração de
            contas que pertencem à organização.
          </p>
        </Clause>

        <Clause title="1.4. O que fica no nome de quem">
          <ul>
            <li>
              <strong>No nome da organização:</strong> a conta e o número de
              WhatsApp, o certificado digital, a conta em que ela recebe dos
              clientes dela, a emissão dos documentos fiscais e as obrigações
              tributárias e profissionais.
            </li>
            <li>
              <strong>No nome do licenciante:</strong> o código, o repositório, a
              marca {APP_NAME}, a infraestrutura e a mensalidade da plataforma.
            </li>
          </ul>
          <p>
            O licenciante nunca usa o CPF ou o CNPJ da organização para
            obrigações próprias.
          </p>
        </Clause>

        <Clause title="1.5. Integrações em nome da organização">
          <p>
            Uma integração que age em nome da organização — agenda do Google,
            WhatsApp e, no futuro, emissão de nota fiscal — só funciona depois que
            quem responde por ela a conecta e autoriza, e pode ser desligada a
            qualquer momento. Esta cláusula não liga nenhuma integração sozinha.
          </p>
        </Clause>

        <Clause title="1.6. Preço">
          <p>
            Nesta fase não há cobrança real pela plataforma. Quando houver, preço e
            condições serão apresentados antes, e a organização só passa a pagar se
            contratar.
          </p>
        </Clause>

        <Clause title="1.7. Saída">
          <ul>
            <li>
              A organização pode exportar os próprios dados e excluir a
              organização a qualquer momento, pelo painel.
            </li>
            <li>
              No teste de {TRIAL_DAYS} dias sem assinatura, o painel fecha ao fim
              do prazo. Por {BLOCKED_RETENTION_DAYS} dias ainda é possível
              assinar, exportar ou excluir; depois, os dados são pseudonimizados.
            </li>
            <li>
              O prazo de guarda depois do fim de uma assinatura paga ainda não foi
              definido. Até que seja, nada é apagado automaticamente.
            </li>
          </ul>
        </Clause>

        <Clause title="1.8. Responsabilidade">
          <p>
            A organização responde pelo conteúdo que insere e pelas decisões
            profissionais que toma. O {APP_NAME} é ferramenta de apoio
            administrativo e não decide atendimento.
          </p>
        </Clause>

        <Clause title="1.9. Vigência">
          <p>
            Este contrato vale enquanto durar o teste ou a assinatura. As regras de
            confidencialidade, incidentes e guarda de dados continuam valendo
            depois do fim, pelo tempo em que houver dado guardado.
          </p>
        </Clause>
      </section>

      <section className="space-y-4" aria-labelledby="anexo-tratamento">
        <h2 id="anexo-tratamento">Parte 2 — Anexo de Tratamento de Dados Pessoais</h2>

        <Clause title="2.1. Papéis">
          <p>
            Em relação aos dados das pessoas que a organização atende e da equipe
            dela, a <strong>organização é a controladora</strong> e o licenciante é
            o <strong>operador</strong> (Lei nº 13.709/2018, art. 39): trata os
            dados em nome dela e segundo as instruções dela.
          </p>
          <p>
            Os dados do próprio assinante como cliente do {APP_NAME} — nome,
            e-mail, plano e faturas — são tratados pelo licenciante como
            controlador e seguem a{" "}
            <Link href="/privacidade" className={LINK_CLASSES}>
              Política de Privacidade
            </Link>
            .
          </p>
        </Clause>

        <Clause title="2.2. Finalidade e instruções">
          <p>
            Os dados são tratados só para operar o {APP_NAME} para a organização:
            agenda, cadastro administrativo de clientes, financeiro, mensagens, a
            assistente, avisos com consentimento e trilha de auditoria. Valem como
            instruções os Termos de Uso, este anexo e as configurações que a
            organização faz no painel.
          </p>
          <p>
            O operador não usa os dados para finalidade própria, não os vende, não
            os cruza entre organizações e não os usa para treinar modelos de
            inteligência artificial. Se uma instrução contrariar a lei, o operador
            avisa a organização e não a cumpre até que seja esclarecida.
          </p>
        </Clause>

        <Clause title="2.3. Pessoas e dados tratados">
          <ul>
            <li>
              <strong>Pessoas atendidas:</strong> nome, contato, situação, agenda,
              valores, mensagens e registro de consentimento por canal. Em
              profissões de saúde, o próprio vínculo com a organização pode revelar
              dado sensível.
            </li>
            <li>
              <strong>Equipe da organização:</strong> nome, e-mail, papel e
              registro no conselho, quando houver.
            </li>
            <li>
              <strong>Responsável legal de menor:</strong> nome e vínculo, quando a
              organização informa.
            </li>
          </ul>
        </Clause>

        <Clause title="2.4. Deveres da organização">
          <ul>
            <li>Ter base legal para cada tratamento que fizer pelo {APP_NAME}.</li>
            <li>Colher e registrar o consentimento para avisos, sobre o texto apresentado no painel.</li>
            <li>Informar as pessoas atendidas sobre o uso do {APP_NAME}.</li>
            <li>Não registrar conteúdo clínico nos campos administrativos.</li>
            <li>Obter a autorização do responsável legal quando a pessoa atendida for menor de idade.</li>
            <li>Manter atualizados os acessos da própria equipe.</li>
          </ul>
        </Clause>

        <Clause title="2.5. Confidencialidade e acesso do operador">
          <p>
            Pelo aplicativo, o operador não lê dado de nenhuma organização: as
            regras de acesso negam à administração da plataforma os dados de
            clientes, agenda, financeiro e mensagens. Fora do aplicativo, o
            operador só abre dados de uma organização a pedido escrito dela, para
            suporte, ou por obrigação legal, e registra o motivo.
          </p>
        </Clause>

        <Clause title="2.6. Segurança">
          <ul>
            <li>Isolamento entre organizações, verificado por regras no próprio banco.</li>
            <li>Segundo fator obrigatório para o acesso administrativo.</li>
            <li>Registro dos atos administrativos que não pode ser alterado.</li>
            <li>Criptografia em trânsito e em repouso.</li>
            <li>Cópia diária dos dados e recuperação a qualquer instante.</li>
          </ul>
        </Clause>

        <Clause title="2.7. Suboperadores">
          <p>
            A organização autoriza os serviços abaixo, que tratam dados em nome do
            operador. Antes de incluir um novo, o operador avisa a organização pelo
            painel e por e-mail.
          </p>
          <ul>
            {SUBPROCESSORS.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong> — {item.purpose} Dados: {item.data}{" "}
                Local: {SUBPROCESSOR_LOCATION_LABEL[item.location]}. {item.locationNote}
              </li>
            ))}
          </ul>
          <p>
            Serviços previstos, como o WhatsApp e a emissão de nota fiscal, só
            entram nesta lista quando forem ligados.
          </p>
        </Clause>

        <Clause title="2.8. Transferência internacional">
          <p>
            Os dados da organização ficam guardados no Brasil. Saem do país só os
            dados tratados por {abroadNames()}, nos limites descritos na lista
            acima.
          </p>
        </Clause>

        <Clause title="2.9. Pedidos das pessoas atendidas">
          <p>
            Quem responde às pessoas atendidas é a organização, que exporta e
            elimina os dados pela própria plataforma. Um pedido que chegar direto
            ao operador é repassado à organização.
          </p>
        </Clause>

        <Clause title="2.10. Incidentes de segurança">
          <p>
            O operador comunica a organização, sem demora, sobre incidente que
            possa gerar risco ou dano relevante às pessoas atendidas, informando o
            que aconteceu, quais dados foram afetados, o que já foi feito e o
            contato para acompanhamento.
          </p>
        </Clause>

        <Clause title="2.11. Fim do tratamento">
          <p>
            Ao fim do contrato vale a cláusula 1.7. Depois de uma exclusão, a
            trilha de auditoria continua guardada sem o que identifica as pessoas,
            e o dado eliminado ainda existe nas cópias de segurança por até 7 dias.
          </p>
        </Clause>

        <p>
          Contato sobre este contrato e sobre dados:{" "}
          <a className={LINK_CLASSES} href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
