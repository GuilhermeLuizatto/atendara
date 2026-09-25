# Atendara

![Ilustração conceitual dos módulos conectados da Atendara](assets/atendara-overview.png)

**Mais tempo para atender.**

Plataforma multiprofissional em desenvolvimento para organizar **agenda, clientes,
mensagens e financeiro**.

Dara é a assistente para a rotina administrativa: aplica regras configuradas pelo
profissional e encaminha assuntos que exigem atenção humana.

> **A IA auxilia. O humano decide.**

**Estágio atual:** demonstração e desenvolvimento. Os módulos têm persistência
no Firestore com isolamento por organização. Dara usa um motor de simulação,
o provedor de mensagens é simulado e a cobrança usa o modo de testes do gateway.
Isso não representa integrações de WhatsApp, n8n ou IA externa em produção.

## Para conhecer o projeto

- **Problema:** a rotina de quem atende pessoas fica distribuída entre agenda,
  cadastros, mensagens e controle financeiro.
- **Solução:** reunir esses fluxos em uma base configurável por profissão, com
  permissões e regras administrativas explícitas.
- **Diferenciais técnicos:** isolamento por organização, domínio independente do
  Firebase, configuração de profissões, auditoria e testes automatizados.

| O que avaliar | Onde começar |
| --- | --- |
| Decisões e limites da arquitetura | [Arquitetura](docs/ARCHITECTURE.md) |
| Estrutura dos dados e consultas | [Modelo do Firestore](docs/FIRESTORE-DATA-MODEL.md) |
| Profissões como configuração | [Definições](src/config/professions/definitions.ts) |
| Permissões e proteção dos dados | [Matriz de permissões](src/config/permissions.ts) e [Security Rules](firestore.rules) |
| Motor administrativo da Dara | [Decisões](src/lib/ai/decision-engine.ts) e [testes](src/lib/ai/decision-engine.test.ts) |
| Fila de automação no servidor | [Cloud Functions](functions/automation.js) |
| Integração contínua | [Workflow de CI](.github/workflows/ci.yml) |

O repositório é mantido por [Guilherme Luizatto](https://github.com/GuilhermeLuizatto).
O [histórico de desenvolvimento](https://github.com/GuilhermeLuizatto/atendara/commits/main/)
registra assistência de IA e coautorias. As funcionalidades descritas aqui
representam o estado do projeto, sem alegação de autoria individual exclusiva.

---

## Stack

| Camada    | Tecnologia                         |
| --------- | ---------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack) |
| UI        | React 19, Tailwind CSS 4           |
| Linguagem | TypeScript 5 (strict)              |
| Auth      | Firebase Authentication            |
| Banco     | Cloud Firestore                    |
| Backend   | Cloud Functions (southamerica-east1) |
| Hosting   | Firebase Hosting (export estatico) |
| Testes    | Vitest e emuladores do Firebase    |
| Qualidade | ESLint 9, Prettier                 |
| CI/CD     | GitHub Actions                     |

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
| Configuracoes    | `/configuracoes` | Profissao, equipe, agenda, privacidade e avisos         |
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
`STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` no Secret Manager.

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
| `npm run scan:secrets` | Varre a arvore versionada atras de credencial               |
| `npm run format`       | Prettier                                                   |
| `npm run verify`       | lint + type-check + testes + build + conferencia do bundle |

Suites que exigem o emulador (Java e a CLI do Firebase):

| Comando                   | O que prova                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| `npm run test:rules`      | Security Rules: isolamento entre organizacoes, modulos, append-only  |
| `npm run test:repository` | Fiacao do repositorio: `Timestamp` <-> ISO, lote atomico, transacao  |
| `npm run test:access`     | Matriz de acesso e cobranca: Auth, callables, webhook e regras juntos |
| `npm run test:emulator`   | As tres em sequencia                                                 |

---

## Deploy

O build gera um site estatico em `out/`, servido pelo Firebase Hosting.

```bash
firebase deploy --only functions
npm run build
firebase deploy --only firestore:rules,firestore:indexes
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

| Configuração | Para que serve |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Provedor de federação usado na autenticação OIDC |
| `GCP_SERVICE_ACCOUNT` | Conta de serviço usada pela federação |
| `FIREBASE_PROJECT_ID` | Projeto de destino |
| `NEXT_PUBLIC_FIREBASE_*` | Identificadores públicos do Firebase usados no build |
| `NEXT_PUBLIC_APP_CHECK_SITE_KEY` | Chave pública do App Check |

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

| Fase | Escopo | Status |
| --- | --- | --- |
| **0** | Fundação: tipos, multi-tenancy, Security Rules, design system, shell e CI | ✅ |
| **1** | Operação: dashboard, agenda, CRM, financeiro, mensagens, regras e simulador | ✅ |
| **2** | Persistência: Firestore, RBAC, auditoria, notificações e isolamento entre tenants | ✅ |
| **3A** | Automação interna: fila, HMAC, callback, controle de emergência e n8n local | ✅ |
| **3B** | WhatsApp: remetente, modelos, saída, entrada, consentimento e risco | ⏸️ Em espera; validação externa pendente |
| **3C** | Integrações operacionais: remarcação, Google Calendar, e-mail com domínio e monitoramento | 🟨 Conexão Google e consulta manual implementadas; ativação real pendente |
| **4** | IA: assistente autorizado, regras contextuais, classificação avançada e analytics | 🟨 Gemini ativo para organizações de teste; acerto revisado e entrega nos indicadores; expansão para tenants reais pendente |
| **5** | Produto: equipes, importação administrativa, suporte, cobrança real e planos | 🟨 |
| **6** | Expansão: portfólio da Estética, marketplace e cobrador dos clientes | ⬜ |

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
allowlist explícita (`GEMINI_ORGANIZATION_IDS`) a um conjunto de organizações
de teste — nenhum tenant real está habilitado ainda. A chave fica no Secret
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
entregue ao aparelho, lida, simulada e falha. A expansão para tenants reais
continua pendente: depende de base legal aprovada e da D26.

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
5. Google Calendar em **Configurações → Google Calendar**: conexão própria,
   desconexão e consulta manual de livre/ocupado da agenda principal por 30 dias.
   A ativação depende de OAuth, KMS, publicação das functions e teste autorizado
   com uma conta Google; seguir [o roteiro](docs/GOOGLE-CALENDAR.md).
   Escrita de eventos, atualização automática, bloqueio de horários, remarcação,
   e-mail e monitoramento continuam pendentes. A 3B fica em espera enquanto
   esta primeira frente da 3C é validada.
6. Depois do piloto, priorizar equipes, importação de dados administrativos e
   suporte. O cobrador de clientes só começa após decisão contábil, jurídica e
   de gateway sobre split, responsabilidade fiscal e consentimento.

Planos e billing da plataforma continuam em modo de testes. A IA externa
(Gemini) está ativa em produção apenas para organizações de teste, sob
allowlist explícita; equipes, marketplace, cobrança de clientes e IA externa
para tenants reais ainda não estão liberados. O sistema continua sem dados
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
