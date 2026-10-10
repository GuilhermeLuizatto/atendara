# Atendara

![Ilustração conceitual dos módulos conectados da Atendara](assets/atendara-overview.png)

**Mais tempo para atender.**

Plataforma multiprofissional em desenvolvimento para organizar **agenda, clientes,
mensagens e financeiro**.

Dara é a assistente para a rotina administrativa: aplica regras configuradas pelo
profissional e encaminha assuntos que exigem atenção humana.

> **A IA auxilia. O humano decide.**

**Estágio atual (10/10/2026):** desenvolvimento e validação controlada. Os
módulos têm persistência no Firestore com isolamento por organização. A Dara
combina regras locais com classificação semântica por Gemini, liberada somente
para organizações de uma lista explícita. A fila de automação e a integração
local com n8n existem; o WhatsApp real aguarda habilitação e validação pela Meta.
A cobrança da plataforma permanece em testes. Código integrado, publicação e
validação real são etapas distintas; confirme a situação de cada frente antes de
usá-la no piloto.

## Para conhecer o projeto

- **Problema:** a rotina de quem atende pessoas fica distribuída entre agenda,
  cadastros, mensagens e controle financeiro.
- **Solução:** reunir esses fluxos em uma base configurável por profissão, com
  permissões e regras administrativas explícitas.
- **Diferenciais técnicos:** isolamento por organização, domínio independente do
  Firebase, configuração de profissões, auditoria e testes automatizados.

| O que avaliar                                       | Onde começar                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Mudanças relevantes integradas à `main`             | [Changelog](CHANGELOG.md)                                                                |
| Rotina de colaboração com agentes                   | [Guia dos agentes](docs/AGENTES-DESENVOLVIMENTO.md)                                      |
| Decisões e limites da arquitetura                   | [Arquitetura](docs/ARCHITECTURE.md)                                                      |
| Estrutura dos dados e consultas                     | [Modelo do Firestore](docs/FIRESTORE-DATA-MODEL.md)                                      |
| Profissões como configuração                        | [Definições](src/config/professions/definitions.ts)                                      |
| Permissões e proteção dos dados                     | [Matriz de permissões](src/config/permissions.ts) e [Security Rules](firestore.rules)    |
| Motor administrativo da Dara                        | [Decisões](src/lib/ai/decision-engine.ts) e [testes](src/lib/ai/decision-engine.test.ts) |
| Fila de automação no servidor                       | [Cloud Functions](functions/automation.js)                                               |
| Integração contínua                                 | [Workflow de CI](.github/workflows/ci.yml)                                               |

O repositório é mantido por [Guilherme Luizatto](https://github.com/GuilhermeLuizatto).
O [histórico de desenvolvimento](https://github.com/GuilhermeLuizatto/atendara/commits/main/)
registra assistência de IA e coautorias. As funcionalidades descritas aqui
representam o estado do projeto, sem alegação de autoria individual exclusiva.

---

## Stack

| Camada    | Tecnologia                           |
| --------- | ------------------------------------ |
| Framework | Next.js 16 (App Router, Turbopack)   |
| UI        | React 19, Tailwind CSS 4             |
| Linguagem | TypeScript 5 (strict)                |
| Auth      | Firebase Authentication              |
| Banco     | Cloud Firestore                      |
| Backend   | Cloud Functions (southamerica-east1) |
| Hosting   | Firebase Hosting (export estatico)   |
| Testes    | Vitest e emuladores do Firebase      |
| Qualidade | ESLint 9, Prettier                   |
| CI/CD     | GitHub Actions                       |

---

## Areas do sistema

| Area             | Rota             | O que faz                                               |
| ---------------- | ---------------- | ------------------------------------------------------- |
| Dashboard        | `/dashboard`     | Visao do dia: atendimentos, mensagens, receita, alertas |
| Agenda           | `/agenda`        | Atendimentos nas visoes diaria, semanal e mensal        |
| Clientes         | `/clientes`      | CRM administrativo, com nome adaptado a profissao       |
| Mensagens        | `/mensagens`     | Caixa de entrada com classificacao e acao da IA         |
| Financeiro       | `/financeiro`    | Receitas, pendencias e atrasos do negocio do assinante  |
| Dara             | `/agente`        | Regras, decisoes auditaveis e simulador                 |
| Equipe           | `/equipe`        | Convites, vínculos, suspensão e remoção                 |
| Importação       | `/importacao`    | CSV/XLSX, mapeamento, prévia e duplicidades por linha   |
| Suporte          | `/suporte`       | Chamados autenticados e conversa oficial no painel      |
| Configuracoes    | `/configuracoes` | Profissao, marca, agenda, privacidade e avisos          |
| Minha assinatura | `/assinatura`    | Plano, situacao e cobrancas da mensalidade do Atendara  |
| Administracao    | `/admin`         | Cadastros, acesso e a cobranca da plataforma            |

`/financeiro` e `/assinatura` nao se misturam: um e o dinheiro que o assinante
recebe do proprio cliente, o outro e a mensalidade que ele paga a operadora.

A nomenclatura acompanha a profissao ativa: o mesmo menu mostra **Pacientes**
para o dentista, **Alunos** para o personal trainer e **Clientes** para o
terapeuta.

---

## Arquitetura

```
Presentation  →  Application  →  Domain  →  Infrastructure  →  Firebase
```

O dominio nao importa nada de `firebase/*`. Regras, permissoes e configuracao de
profissoes sao testaveis sem SDK, sem emulador e sem rede.

Quatro decisoes que sustentam o resto:

1. **Isolamento por organizacao em tres camadas** — caminho no Firestore,
   Security Rules e campo no documento. O frontend nao participa da seguranca.
2. **Profissao e dado, nao codigo** — adicionar uma profissao e acrescentar uma
   entrada em uma tabela de configuracao.
3. **So o administrativo e automatizavel** — a trava esta em uma tabela de
   metadata que o motor consulta, protegida por testes.
4. **Toda decisao do agente e registro imutavel** — classificacao, confianca,
   regras aplicadas, motivo e versao do motor.

Detalhes em **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**; forma dos
documentos, consultas e indices em
**[docs/FIRESTORE-DATA-MODEL.md](docs/FIRESTORE-DATA-MODEL.md)**.

---

## Fluxo do produto

```
Mensagem do cliente
        ↓
Classificacao (com confianca)
        ↓
Regras fundamentais  →  da profissao  →  do profissional  →  contextuais
        ↓
Permissoes do papel responsavel
        ↓
   ┌────┴────┐
RESPONDER   ESCALAR ──→ Alerta priorizado ──→ Profissional
   └────┬────┘
        ↓
Decisao registrada (auditoria)
```

Mensagem classificada como possivel risco **interrompe a automacao**, gera alerta
critico e aguarda o humano — sem excecao e sem possibilidade de o usuario
desligar.

---

## Setup

Requisitos: **Node.js 22** e npm, alinhados ao ambiente de integracao continua.

```bash
npm ci
npm ci --prefix functions
node scripts/create-demo-admin.mjs
npm run dev
```

Abra <http://localhost:3000>.

Sem configuracao de Firebase a aplicacao roda em **modo demonstracao**, com
contas no navegador e dados ficticios. O comando de preparacao gera um acesso
administrativo exclusivo para esta copia em `.local/admin-initial-access.txt`.
Use esse acesso na tela de login e defina uma nova senha quando solicitado.

`.local/` e `.env.local` ficam fora do Git. O verificador desse acesso so entra
em build de demonstracao; `npm run check:bundle` confere que ele nao vai para um
build com Firebase configurado.

### Conectar a um projeto Firebase (opcional)

Adicione os campos de `.env.example` ao arquivo `.env.local`, preservando a
configuracao administrativa local gerada no passo anterior. Preencha com os
dados de **Firebase Console → Configuracoes do projeto → Seus apps →
Configuracao do SDK**. Nenhum desses valores e segredo: sao identificadores
publicos que vao no bundle de qualquer aplicacao Firebase. A protecao dos dados
esta nas Security Rules.

Depois habilite **Authentication → Sign-in method → E-mail/senha** e crie o
Firestore. As Cloud Functions exigem o plano Blaze; as de cobranca exigem ainda
`STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` no Secret Manager. Convites e
notificações de suporte usam o Amazon SES já configurado, com
`SES_ACCESS_KEY_ID` e `SES_SECRET_ACCESS_KEY` no Secret Manager e remetente em
`SES_FROM_EMAIL`.

### Emuladores locais

```bash
cp .firebaserc.example .firebaserc   # e ajuste o id do projeto
firebase emulators:start
```

Com `NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true` no `.env.local`, Auth e Firestore
apontam para os emuladores.

---

## Comandos

| Comando                | O que faz                                                  |
| ---------------------- | ---------------------------------------------------------- |
| `npm run dev`          | Servidor de desenvolvimento                                |
| `npm run build`        | Build de producao (export estatico em `out/`)              |
| `npm run lint`         | ESLint                                                     |
| `npm run type-check`   | Gera tipos de rota e roda `tsc --noEmit`                   |
| `npm run test`         | Suite de testes                                            |
| `npm run check:bundle` | Confere que nenhum segredo foi parar em `out/`             |
| `npm run scan:secrets` | Varre a arvore versionada atras de credencial              |
| `npm run format`       | Prettier                                                   |
| `npm run verify`       | lint + type-check + testes + build + conferencia do bundle |

Suites que exigem o emulador (Java e a CLI do Firebase):

| Comando                   | O que prova                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `npm run test:rules`      | Security Rules: isolamento entre organizacoes, modulos, append-only   |
| `npm run test:storage`    | Arquivos: logo, anexos, tipos, tamanhos e visibilidade                |
| `npm run test:repository` | Fiacao do repositorio: `Timestamp` <-> ISO, lote atomico, transacao   |
| `npm run test:access`     | Matriz de acesso e cobranca: Auth, callables, webhook e regras juntos |
| `npm run test:emulator`   | As quatro suites de emulador em sequencia                             |

---

## Deploy

O build gera um site estatico em `out/`, servido pelo Firebase Hosting.

```bash
firebase deploy --only functions
npm run build
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase deploy --only hosting
```

As **functions vao primeiro**, porque o workflow de `main` nao as publica e o
aplicativo novo nao pode entrar no ar chamando uma function antiga. Depois, as
**Security Rules antes do Hosting**: uma versao nova do frontend nao deve entrar
no ar com o banco ainda desprotegido.

---

## CI/CD

```
install → varredura → lint → type-check → testes → auditoria → build
```

- **`.github/workflows/ci.yml`** — todo push e PR. Executa varredura de segredos,
  lint, tipos, testes, auditoria de dependências, build e análise com CodeQL.
- **`.github/workflows/deploy.yml`** — `main`. Publica Security Rules e indices e
  depois o Hosting; sem credenciais configuradas, registra que pulou e termina
  com sucesso.

Configuração do deploy no GitHub Actions:

| Configuração                     | Para que serve                                       |
| -------------------------------- | ---------------------------------------------------- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Provedor de federação usado na autenticação OIDC     |
| `GCP_SERVICE_ACCOUNT`            | Conta de serviço usada pela federação                |
| `FIREBASE_PROJECT_ID`            | Projeto de destino                                   |
| `NEXT_PUBLIC_FIREBASE_*`         | Identificadores públicos do Firebase usados no build |
| `NEXT_PUBLIC_APP_CHECK_SITE_KEY` | Chave pública do App Check                           |

O workflow usa credenciais temporárias via federação. Se a federação não estiver
configurada, o deploy é pulado. Com a federação configurada, a ausência dos campos
públicos obrigatórios do Firebase ou do App Check interrompe a publicação para
não colocar um build de demonstração no ar.

Nenhum segredo fica no codigo.

---

## Roadmap

O roadmap é dividido por entregas verificáveis. A Fase 3 deixou de ser um
bloco único: o núcleo da fila e os contratos de automação já existem, enquanto
a ativação de canais externos continua controlada por configuração, segredos e
testes de ponta a ponta.

| Fase   | Escopo                                                                                    | Status                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **0**  | Fundação: tipos, multi-tenancy, Security Rules, design system, shell e CI                 | ✅                                                                                                            |
| **1**  | Operação: dashboard, agenda, CRM, financeiro, mensagens, regras e simulador               | ✅                                                                                                            |
| **2**  | Persistência: Firestore, RBAC, auditoria, notificações e isolamento entre tenants         | ✅                                                                                                            |
| **3A** | Automação interna: fila, HMAC, callback, controle de emergência e n8n local               | ✅                                                                                                            |
| **3B** | WhatsApp: remetente, modelos, saída, entrada, consentimento e risco                       | ⏸️ Em espera; validação externa pendente                                                                      |
| **3C** | Integrações operacionais: remarcação, Google Calendar, e-mail com domínio e monitoramento | 🟨 Código integrado à `main` e Functions publicadas; validações reais pendentes                               |
| **4**  | IA: assistente autorizado, regras contextuais, classificação avançada e analytics         | ✅ Gemini por allowlist em 6 organizações; acerto revisado e entrega nos indicadores                          |
| **5**  | Produto: equipes, importação administrativa, suporte, marca e preparação da cobrança      | 🟨 Base, escopo multiprofissional, administração de membros e migração concluídos; validações reais pendentes |
| **6**  | Cobrador dos clientes: mensalidades, comprovantes e recibos, sem processar pagamento      | 🟨 Código integrado à `main`; validações reais pendentes                                                      |

As validações externas ou manuais que dependem do titular, inclusive as da
Fase 3B, são acompanhadas fora do repositório.

### Próximas entregas

A Fase 4 local está disponível em `/agente`: autorizações da Dara, editor de
condições, prévia sem gravação e indicadores por período e profissional. Na
central de mensagens, a Dara prepara um rascunho administrativo para revisão
explícita. Somente OWNER/ADMIN alteram as configurações do agente, com trilha
de auditoria; as permissões existentes das regras e conversas permanecem.

A classificação local continua sendo a primeira e principal camada: trata
limites de palavras, variações de espaços e acentos, sinais sensíveis, negação
e múltiplos pedidos, e um `POSSIBLE_RISK` detectado localmente nunca é
sobrescrito por resultado externo. Sobre essa base, a classificação semântica
com Gemini (`gemini-3.1-flash-lite`) está ativa em produção, mas restrita por
allowlist explícita (`GEMINI_ORGANIZATION_IDS`, sem curinga): cada organização
é liberada pelo titular, e em 25/09/2026 eram 6 de 8. A chave fica no Secret
Manager, vinculada apenas a `previewAI` e `inboundWebhook`, com nível pago
confirmado manualmente (`GEMINI_PAID_TIER_CONFIRMED`). Qualquer falha ou
timeout do Gemini degrada para `UNKNOWN`, que sempre escala para um humano —
a chamada externa nunca decide sozinha. A avaliação automatizada
(`npm run evaluate:gemini`) roda contra os fixtures de segurança antes de
qualquer expansão da lista de organizações. Os indicadores continuam mostrando
a amostra carregada e avisando quando há páginas anteriores. O acerto vem da
revisão humana: na Auditoria, OWNER/ADMIN marcam se a classificação estava
certa (e qual seria), numa coleção própria (`aiDecisionReviews`), sem tocar na
decisão; decisão sem revisão fica fora da conta, e o acerto aparece separado
entre Gemini e regras locais. O uso do Gemini mostra situação e tokens, não
custo em reais. A entrega das respostas da Dara separa aceita pelo provedor,
entregue ao aparelho, lida, simulada e falha.

A avaliação de 25/09/2026 deu 18 de 20, com uma resposta insegura do Gemini
sozinho. Os dois casos divergentes (negação e injeção com pergunta de dose)
não chegam ao Gemini em produção: a classificação local os marca como ambíguo
ou clínico nas nove profissões, e o Gemini só é consultado quando a guarda
local não vê ambiguidade. A liberação foi decidida pelo titular com esse
resultado.

1. Validar a saída do WhatsApp em modo de teste com o número e o destinatário
   autorizados pela Meta.
2. Validar a entrada pelo webhook, incluindo assinatura, identificação do
   tenant, classificação, escalonamento e opt-out.
3. Colocar o n8n em ambiente HTTPS controlado, com rotação dos segredos e
   monitoramento antes de qualquer piloto.
4. Painel operacional implementado em **Configurações → Fila de automações**:
   filtros, tentativas, histórico e indicação de tarefas que precisam de atenção.
   A rotina de vencimento gera alerta interno e auditoria sem depender do executor.
   Para ativá-la, publicar o índice de `automationTasks` e a function
   `expireAutomationTasksEveryFiveMinutes`; validar em ambiente de teste antes do piloto.
5. A Fase 3C está concluída no código: o Google Calendar tem conexão própria,
   escrita na agenda "Atendara", leitura manual e automática do ocupado e um
   alerta único de reconexão no painel; o sufixo técnico `[503]` não chega mais
   à mensagem da interface. A remarcação autônoma está provada no sandbox, e o
   e-mail sai pelo domínio próprio. As Functions da frente 3 foram publicadas em
   produção em 25/09/2026, e a interface foi integrada à `main` pelo
   [PR #66](https://github.com/GuilhermeLuizatto/atendara/pull/66).
   Permanecem os testes reais que exigem o titular e a verificação do escopo
   sensível pelo Google antes do piloto aberto; seguir [o roteiro](docs/GOOGLE-CALENDAR.md).
   O reteste real do e-mail passou em 25/09/2026 com um endereço inédito: a
   mensagem chegou à caixa principal e o link confirmou o endereço. A 3B
   continua em espera pela validação externa da Meta.
6. A Fase 5 tem a base concluída no código: equipe por convite de sete dias,
   solicitação interna por profissional, importação CSV/XLSX com
   mapeamento e decisão por duplicidade, chamados autenticados no painel,
   anexos protegidos e logo da organização. O Amazon SES envia somente os
   convites e avisos; a conversa de suporte permanece no painel. O vínculo com
   vários profissionais já limita consultas, escritas, callables e Security
   Rules; perder um vínculo retira os dados da sessão aberta imediatamente.
   O contexto explícito por abas e os clientes compartilhados estão concluídos
   no código (5.4), e a migração auditável dos dados antigos (5.5) foi
   aplicada em produção em 30/09/2026, sem pendências. A frente de equipe só
   fica liberada para o piloto multiprofissional depois da validação real com
   contas de teste: administração de membros, abas por profissional e
   isolamento entre vínculos. O catálogo e os preços
   dos planos continuam deliberadamente em espera, e a Stripe segue travada
   para uso real até a decisão comercial, jurídica, fiscal e o teste
   explicitamente autorizado.

### Sprints do acesso multiprofissional do piloto

Estes sprints fecham a diferença entre registrar um vínculo e usá-lo como
fronteira real de autorização. A ordem é deliberada: nenhuma aba pode ser
tratada como proteção antes de consultas, backend e Security Rules aplicarem o
mesmo escopo.

| Sprint                                                       | Entrega                                                                                                                                                                                                                                                                                                                                                                      | Critério de aceite                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **5.1 — Contrato de acesso**                                 | Consolidar `PLATFORM_ADMIN` como papel interno da Atendara, `PROFESSIONAL` e `ASSISTANT` como acessos da organização, e `Client` como cadastro administrativo sem login no piloto. Titularidade continua separada do papel.                                                                                                                                                  | Novos convites não oferecem OWNER, ADMIN organizacional ou VIEWER; compatibilidade com contas antigas permanece documentada e testada.                                                                                         |
| **5.2 — Administração de membros**                           | Fazer convite, suspensão, reativação e remoção por operações específicas da administração da Atendara, com segundo fator, motivo e auditoria. O profissional solicita a inclusão, mas não cria a conta diretamente.                                                                                                                                                          | O administrador não ganha leitura geral do tenant; cada ato administrativo é autorizado no backend, revoga sessões quando necessário e gera registro append-only.                                                              |
| **5.3 — Escopo por vínculo (concluído no código)**           | Aplicar `linkedProfessionalIds` nas consultas, escritas, callables e Security Rules de agenda, clientes, mensagens, financeiro, regras e alertas. Vínculo vazio nunca significa acesso a todos.                                                                                                                                                                              | Um assistente ligado aos profissionais A e B não lê nem altera dados do profissional C, inclusive por chamada direta ao Firestore ou às Functions. Testes de emulador cobrem leitura, criação, alteração e remoção de vínculo. |
| **5.4 — Contexto por abas e clientes (concluído no código)** | Criar um contexto global por profissional, com uma aba para cada vínculo ativo e sem opção silenciosa de combinar dados. O profissional ou assistente autorizado cadastra clientes diretamente; a administração da Atendara não participa do fluxo cotidiano. Um cliente da organização pode ser associado explicitamente a mais de um profissional sem duplicar o cadastro. | Agenda, clientes, mensagens, financeiro e Dara seguem a mesma aba ativa. Trocar ou perder vínculo troca ou fecha o contexto imediatamente. O cadastro do cliente não cria conta de acesso.                                     |
| **5.5 — Migração e liberação (aplicada em produção)**        | Preservar UID, e-mail, senha, organização, perfis e histórico; mapear papéis antigos, preencher vínculos explícitos e revisar manualmente organizações multiprofissionais ambíguas.                                                                                                                                                                                          | Migração repetível e auditável, sem concessão implícita de acesso. Contagens antes/depois conferidas, testes completos aprovados e piloto bloqueado enquanto houver membro ativo sem escopo resolvido.                         |

Situação do sprint 5.2: concluído no código. Aprovação/recusa, convite,
suspensão, reativação e remoção são exclusivos da administração da Atendara,
com TOTP, motivo e trilha append-only. Remover revoga sessões, pseudonimiza os
dados pessoais e apaga o login sem alterar assinatura nem validade da plataforma.

Situação do sprint 5.3: concluído no código. OWNER e ADMIN mantêm escopo da
organização; PROFESSIONAL, ASSISTANT e VIEWER veem somente os ids explícitos no
vínculo. Lista ausente ou vazia nega tudo. O mesmo campo desnormalizado limita
consultas, planos de escrita, callables e Rules, e a suíte do emulador prova
acesso A/B, negação C e retirada imediata de B. Dado sem o campo de escopo
continua fechado; a migração do sprint 5.5 preencheu os dados antigos.

Situação do sprint 5.4: concluído no código. O painel oferece uma aba para cada
profissional ativo alcançado pelo vínculo e não oferece visão combinada. Agenda,
clientes, mensagens, financeiro e Dara derivam a mesma fotografia da aba ativa;
se ela deixa de existir, a sessão escolhe outro vínculo ativo ou fecha as áreas
operacionais. `clients.assignedProfessionalIds` permite que o mesmo cadastro
apareça explicitamente em mais de um contexto. Consultas, planos, importação e
Security Rules usam a lista sem criar conta de acesso para o cliente. Os dados
anteriores ao campo plural foram preenchidos pela migração do sprint 5.5.

Situação do sprint 5.5: ferramenta concluída no código e migração aplicada em
produção em 30/09/2026; a conferência posterior terminou com todas as
organizações limpas, sem escritas ou pendências restantes.
`functions/migrate-scope.js` faz simulação por padrão e só grava com `--apply`.
Ele preserva UID, e-mail, senha, organização,
perfis e histórico (não toca em Authentication nem muda papéis) e só escreve
`linkedProfessionalIds` (membros), `assignedProfessionalIds` (clientes) e
`professionalId` (agenda, conversas, mensagens, financeiro, cobrador, recibos,
revisões, avisos, entregas, tarefas e ocupado do calendário). Regras:

- organização com **um** profissional ativo: tudo que não tem escopo passa a ser
  dele; profissional sem vínculo é ligado ao próprio perfil ativo. Vínculo ou
  decisão que aponte para perfil inativo continua fechado para revisão;
- organização com **dois ou mais**: só se grava o que tem evidência no próprio
  dado (agendamento, cliente já associado, conversa, lançamento). O restante vai
  para o relatório como pendência manual e a organização **não é gravada**
  enquanto houver pendência; as decisões entram em um arquivo (fora do Git):
  `{ "<organizationId>": { "defaultProfessionalId": "...", "members": { "<uid>": ["<professionalId>"] }, "clients": { "<clientId>": ["<professionalId>"] } } }`;
- `aiDecisions` e `auditLogs` (append-only) nunca são alterados: decisões antigas
  sem escopo ficam visíveis só a OWNER/ADMIN;
- cada organização gravada registra `SCOPE_MIGRATION_STARTED` com o UID real da
  conta administrativa que executou o ato e, depois de reler e
  conferir que o plano voltou vazio, `SCOPE_MIGRATION_COMPLETED` (ou `..._FAILED`)
  em `platformAuditLogs`, com contagens e sem dado pessoal;
- a aprovação de novos membros fica bloqueada (`failed-precondition`) enquanto
  houver membro ativo sem escopo resolvido.

Roteiro: `node functions/migrate-scope.js atendo-a3481` (relatório em `.local/`),
revisar, preencher as decisões, repetir com `--decisions <arquivo>` e, só então,
`--actor <uid-da-operadora> --apply` (`--org <id>` limita a uma organização). Em
produção, o e-mail dessa conta precisa ser o mesmo usado pelo `firebase login`.

Fica fora destes sprints: portal do cliente, assistente em várias organizações,
permissões personalizadas por usuário, transferência de titularidade e visão
consolidada de vários profissionais. Essas expansões só entram depois de o
isolamento individual do piloto estar validado.

Planos e billing da plataforma continuam em modo de testes. A IA externa
(Gemini) está ativa em produção só para as organizações da allowlist
explícita; equipes e cobrança de clientes ainda não estão
liberados. O sistema continua sem dados
reais e sem afirmar conformidade com a LGPD.

---

## Seguranca e privacidade

- **Isolamento por tenant** garantido nas Security Rules, nao na interface.
- **RBAC** com cinco papeis (OWNER, ADMIN, PROFESSIONAL, ASSISTANT, VIEWER),
  aplicado no banco.
- **Regras fundamentais imutaveis**: nenhum papel, nem o proprietario, consegue
  editar ou desativar.
- **Auditoria append-only**: `aiDecisions` e `auditLogs` recusam `update` e
  `delete`.
- **Assinatura so muda pelo webhook**, depois de conferir a assinatura
  criptografica do evento. O navegador nao escreve em nenhuma colecao de
  cobranca.
- **Avisos ao cliente sao opt-in explicito**: exigem regra habilitada, contato
  valido e consentimento que nomeie o canal.
- **Separacao entre dado administrativo e dado sensivel** desde a modelagem. Nao
  ha prontuario clinico no MVP, e o agente nao copia conversa para o cadastro.
- **Nenhum dado real** e usado em nenhum ambiente.

Este projeto e descrito como **arquitetado considerando principios de privacidade
e protecao de dados**. Nao ha afirmacao de conformidade com a LGPD: adequacao de
producao exige validacao tecnica e juridica fora do escopo deste estagio.

---

## Licenca

Projeto de portfolio e estudo. Sem licenca de uso definida.

### Varredura de segredos

```bash
npm run scan:secrets              # arvore versionada
npm run scan:secrets:historico    # + todos os commits
git config core.hooksPath scripts/hooks   # varre o indice a cada commit
```

O relatorio mostra caminho e linha, nunca o valor. Falso positivo se resolve em
`ALLOWED`, dentro de `scripts/scan-secrets.mjs`, com o motivo escrito.
