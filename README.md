# Atendara

![Ilustração conceitual dos módulos conectados da Atendara](assets/atendara-overview.png)

**Mais tempo para atender.**

Plataforma multiprofissional em desenvolvimento para organizar **agenda, clientes,
mensagens e financeiro**. É um case real de produto em validação e também parte
do portfólio técnico do projeto.

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

## Estado verificado em 10/10/2026

O projeto já tem as áreas principais no código, mas o piloto ainda depende de
validações controladas. A tabela distingue entrega técnica de prova em uso real;
o [radar](project-dashboard/atendara-dashboard.html) guarda o próximo passo de cada frente.

| Frente                                                           | Situação                                                                                                           | Evidência e próximo passo                                                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Núcleo, agenda, clientes, mensagens, financeiro e regras da Dara | Implementados no código, com persistência e testes automatizados; a validação real do piloto continua pendente     | [Arquitetura](docs/ARCHITECTURE.md), [testes do motor](src/lib/ai/decision-engine.test.ts) e [painel](PAINEL-ATENDARA.md). Exercitar os fluxos com dados fictícios antes de liberar o piloto. |
| Dara: leads, encaminhamento e tomada humana                      | Código integrado à `main`; fluxo real ainda não confirmado                                                         | [PR #89](https://github.com/GuilhermeLuizatto/atendara/pull/89). Testar recebimento, consentimento, encaminhamento e tomada humana.                                                           |
| Google Calendar, remarcação e e-mail                             | Código integrado; validações reais da frente operacional ainda pendentes                                           | [Guia do Calendar](docs/GOOGLE-CALENDAR.md) e [PR #66](https://github.com/GuilhermeLuizatto/atendara/pull/66). Repetir o roteiro controlado antes do piloto aberto.                           |
| Equipe multiprofissional e migração de escopo                    | Código e migração registrados como concluídos; acesso entre vínculos precisa de validação real com contas de teste | [Arquitetura](docs/ARCHITECTURE.md) e [Security Rules](firestore.rules). Provar que um vínculo não alcança dados de outro.                                                                    |
| Cobrador de clientes                                             | Base integrada; lembrete automático permanece em proposta                                                          | [Roadmap abaixo](#roadmap) e [painel](PAINEL-ATENDARA.md). Definir escopo e consentimento específico antes de enviar avisos.                                                                  |
| WhatsApp real e n8n operacional                                  | Dependem da habilitação da Meta e de ambiente controlado                                                           | [Painel](PAINEL-ATENDARA.md). Validar remetente, modelo, entrada, saída e opt-out com destinatário autorizado.                                                                                |
| Acesso a arquivos e trilhas                                      | Revisão de segurança aberta; correções locais ainda não equivalem a entrega integrada                              | [Painel](PAINEL-ATENDARA.md). Integrar e testar acesso, trilhas e links antigos antes de fechar o risco.                                                                                      |
| Avisos no backend e histórico de consentimento                   | Estado de publicação ou teste real ainda a verificar                                                               | [Radar](project-dashboard/status.json). Conferir Functions, fila e ciclo de consentimento antes de declarar conclusão.                                                                        |

**Teste automatizado não é validação de produção.** A suite local verifica
regras e comportamento; integração com provedores, autorização de canais e
fluxos do piloto exigem execução controlada e registro de evidência. Itens sem
prova recente aparecem como **a verificar** no radar.

## Para conhecer o projeto

- **Problema:** a rotina de quem atende pessoas fica distribuída entre agenda,
  cadastros, mensagens e controle financeiro.
- **Solução:** reunir esses fluxos em uma base configurável por profissão, com
  permissões e regras administrativas explícitas.
- **Diferenciais técnicos:** isolamento por organização, domínio independente do
  Firebase, configuração de profissões, auditoria e testes automatizados.

| O que avaliar                              | Onde começar                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Desenvolvimento, pendências, bugs e testes | [Radar visual](project-dashboard/atendara-dashboard.html) e [painel de trabalho](PAINEL-ATENDARA.md) |
| Mudanças relevantes integradas à `main`    | [Changelog](CHANGELOG.md)                                                                            |
| Rotina de colaboração com agentes          | [Guia dos agentes](docs/AGENTES-DESENVOLVIMENTO.md)                                                  |
| Decisões e limites da arquitetura          | [Arquitetura](docs/ARCHITECTURE.md)                                                                  |
| Estrutura dos dados e consultas            | [Modelo do Firestore](docs/FIRESTORE-DATA-MODEL.md)                                                  |
| Profissões como configuração               | [Definições](src/config/professions/definitions.ts)                                                  |
| Permissões e proteção dos dados            | [Matriz de permissões](src/config/permissions.ts) e [Security Rules](firestore.rules)                |
| Motor administrativo da Dara               | [Decisões](src/lib/ai/decision-engine.ts) e [testes](src/lib/ai/decision-engine.test.ts)             |
| Fila de automação no servidor              | [Cloud Functions](functions/automation.js)                                                           |
| Integração contínua                        | [Workflow de CI](.github/workflows/ci.yml)                                                           |

Para visualizar o [radar HTML](project-dashboard/atendara-dashboard.html),
clique em **Download raw file** no GitHub e abra o arquivo baixado no navegador;
ele funciona com a cópia de dados incluída mesmo sem acesso à rede.

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
| **3C** | Integrações operacionais: remarcação, Google Calendar, e-mail com domínio e monitoramento | 🟨 Código integrado; publicação registrada em 25/09/2026; validações reais pendentes                          |
| **4**  | IA: assistente autorizado, regras contextuais, classificação avançada e analytics         | 🟨 Código integrado; Gemini limitado por allowlist. Expansão exige avaliação e autorização                    |
| **5**  | Produto: equipes, importação administrativa, suporte, marca e preparação da cobrança      | 🟨 Base, escopo multiprofissional, administração de membros e migração concluídos; validações reais pendentes |
| **6**  | Cobrador dos clientes: mensalidades, comprovantes e recibos, sem processar pagamento      | 🟨 Código integrado à `main`; validações reais pendentes                                                      |

As pendências e validações são acompanhadas no [radar deste repositório](project-dashboard/README.md).
