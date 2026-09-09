# Atendara

**Mais tempo para atender.**

Dara é a assistente de IA da Atendara para a rotina administrativa. Ela auxilia
com informações e encaminha ao profissional os assuntos que exigem atenção humana.

**Plataforma multiprofissional de gestao e automacao para quem atende pessoas.**

Uma plataforma **Three Devs**.

Agenda, CRM, financeiro e central de mensagens com um agente de IA que responde o
administrativo dentro de regras que o profissional define — e encaminha todo o
resto para o humano.

> **A IA auxilia. O humano decide.**

Nao e um sistema para psicologos com outros nomes. O nucleo nao conhece
profissao: terminologia, taxonomia de mensagens, regras e comportamento da
interface vem de configuracao. A mesma base atende psicologo, psiquiatra, medico,
dentista, nutricionista, fisioterapeuta, terapeuta e personal trainer.

**Status:** em desenvolvimento, com dashboard, agenda, clientes, mensagens e
simulador da Dara navegaveis. A gestao de acesso separa o administrador da
plataforma dos profissionais. Os dados administrativos continuam locais e
ficticios; a Dara usa um motor de simulacao, sem envio para canais externos.

A publicacao deste repositorio no GitHub nao significa que o aplicativo esteja
implantado em producao. Firebase Authentication, Firestore, funcoes de gestao
de contas e Hosting exigem configuracao e validacao no ambiente de destino.

---

## Stack

| Camada    | Tecnologia                         |
| --------- | ---------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack) |
| UI        | React 19, Tailwind CSS 4           |
| Linguagem | TypeScript 5 (strict)              |
| Auth      | Firebase Authentication            |
| Banco     | Cloud Firestore                    |
| Hosting   | Firebase Hosting (export estatico) |
| Testes    | Vitest                             |
| Qualidade | ESLint 9, Prettier                 |
| CI/CD     | GitHub Actions                     |

---

## Areas do sistema

| Area          | Rota             | O que faz                                               |
| ------------- | ---------------- | ------------------------------------------------------- |
| Dashboard     | `/dashboard`     | Visao do dia: atendimentos, mensagens, receita, alertas |
| Agenda        | `/agenda`        | Atendimentos nas visoes diaria, semanal e mensal        |
| Clientes      | `/clientes`      | CRM administrativo, com nome adaptado a profissao       |
| Mensagens     | `/mensagens`     | Caixa de entrada com classificacao e acao da IA         |
| Financeiro    | `/financeiro`    | Receitas, pendencias e atrasos derivados da agenda      |
| Dara          | `/agente`        | Regras, decisoes auditaveis e simulador                 |
| Configuracoes | `/configuracoes` | Profissao, equipe, agenda e privacidade                 |

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

Detalhes, custos e limitacoes conhecidas em **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

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
O administrador cadastra os profissionais e libera os acessos pertinentes.

`.local/` e `.env.local` ficam fora do Git. Nao publique a senha inicial nem
o verificador local. Esse acesso de demonstracao nao cria uma conta no Firebase.

### Conectar a um projeto Firebase (opcional)

Adicione os campos de `.env.example` ao arquivo `.env.local`, preservando
a configuracao administrativa local gerada no passo anterior. Preencha com os dados de
**Firebase Console → Configuracoes do projeto → Seus
apps → Configuracao do SDK**. Nenhum desses valores e segredo: sao
identificadores publicos que vao no bundle de qualquer aplicacao Firebase. A
protecao dos dados esta nas Security Rules.

Depois habilite **Authentication → Sign-in method → E-mail/senha** e crie o
Firestore.

Para provisionar o administrador e implantar as funcoes de gestao de contas,
consulte [FIREBASE-SETUP.md](docs/FIREBASE-SETUP.md). A criacao do projeto
Firebase, por si so, nao ativa esses fluxos. Enquanto a implantacao nao estiver
concluida, mantenha `NEXT_PUBLIC_DEMO_MODE=true` para explorar o modo local.

### Emuladores locais

```bash
cp .firebaserc.example .firebaserc   # e ajuste o id do projeto
firebase emulators:start
```

Com `NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true` no `.env.local`, Auth e Firestore
apontam para os emuladores.

---

## Comandos

| Comando              | O que faz                                     |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | Servidor de desenvolvimento                   |
| `npm run build`      | Build de producao (export estatico em `out/`) |
| `npm run lint`       | ESLint                                        |
| `npm run type-check` | Gera tipos de rota e roda `tsc --noEmit`      |
| `npm run test`       | Suite de testes                               |
| `npm run format`     | Prettier                                      |
| `npm run verify`     | lint + type-check + testes + build            |

Suites que exigem o emulador (Java e `.local/firebase-tools`):

| Comando                  | O que prova                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `npm run test:rules`     | Security Rules: isolamento entre organizacoes, modulos, append-only |
| `npm run test:repository`| Fiacao do repositorio: `Timestamp` <-> ISO, lote atomico, transacao |
| `npm run test:access`    | Matriz de acesso: Auth + callable functions + regras juntas   |
| `npm run test:emulator`  | As tres em sequencia                                          |

Resultados da matriz em [docs/MATRIZ-DE-ACESSO.md](docs/MATRIZ-DE-ACESSO.md).

---

## Deploy

O build gera um site estatico em `out/`, servido pelo Firebase Hosting.

```bash
npm run build
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

Publique as **Security Rules antes do Hosting**: uma versao nova do frontend nao
deve entrar no ar com o banco ainda desprotegido. O workflow de deploy ja faz
nessa ordem.

---

## CI/CD

```
install → lint → type-check → testes → build → deploy
```

- **`.github/workflows/ci.yml`** — todo push e PR. Funciona em fork sem segredos.
- **`.github/workflows/deploy.yml`** — `main`. Publica Security Rules e depois o
  Hosting; sem credenciais configuradas, registra que pulou e termina com
  sucesso.

Segredos necessarios para o deploy:

| Segredo                    | Para que serve                                   |
| -------------------------- | ------------------------------------------------ |
| `FIREBASE_SERVICE_ACCOUNT` | JSON da conta de servico com permissao de deploy |
| `FIREBASE_PROJECT_ID`      | Id do projeto Firebase                           |
| `NEXT_PUBLIC_FIREBASE_*`   | Configuracao publica usada no build              |

Nenhum segredo fica no codigo.

---

## Roadmap original

Esta tabela registra o planejamento inicial. Para o trabalho implementado
posteriormente e suas limitacoes, consulte [CONTINUATION.md](docs/CONTINUATION.md).

| Fase  | Escopo                                                                    | Status |
| ----- | ------------------------------------------------------------------------- | ------ |
| **0** | Fundacao: tipos, multi-tenancy, Security Rules, design system, shell, CI  | ✅     |
| **1** | Modulos: dashboard, agenda, CRM, financeiro, mensagens, regras, simulador | ⬜     |
| **2** | Firestore real: repositorios, RBAC aplicado, auditoria, notificacoes      | ⬜     |
| **3** | Automacao: n8n, WhatsApp, Google Calendar, confirmacao e remarcacao       | ⬜     |
| **4** | IA: classificacao avancada, regras contextuais, extracao, analytics       | ⬜     |
| **5** | Escala: clinicas, equipes, planos, billing, marketplace de integracoes    | ⬜     |

---

## Seguranca e privacidade

- **Isolamento por tenant** garantido nas Security Rules, nao na interface.
- **RBAC** com cinco papeis (OWNER, ADMIN, PROFESSIONAL, ASSISTANT, VIEWER),
  aplicado no banco.
- **Regras fundamentais imutaveis**: nenhum papel, nem o proprietario, consegue
  editar ou desativar.
- **Auditoria append-only**: `aiDecisions` e `auditLogs` recusam `update` e
  `delete`.
- **Separacao entre dado administrativo e dado sensivel** desde a modelagem. Nao
  ha prontuario clinico no MVP, e o agente nao copia conversa para o cadastro.
- **Nenhum dado real** e usado em nenhum ambiente.
- **Matriz de acesso verificada de ponta a ponta** no emulador: cadastro,
  senha inicial obrigatoria, isolamento por organizacao e profissao, modulos,
  suspensao, validade e tentativas de autopromocao. Ver
  [docs/MATRIZ-DE-ACESSO.md](docs/MATRIZ-DE-ACESSO.md).

Este projeto e descrito como **arquitetado considerando principios de privacidade
e protecao de dados**. Nao ha afirmacao de conformidade com a LGPD: adequacao de
producao exige validacao tecnica e juridica fora do escopo deste estagio.

---

## Licenca

Projeto de portfolio e estudo. Sem licenca de uso definida.
