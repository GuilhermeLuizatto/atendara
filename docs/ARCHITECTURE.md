# Arquitetura

Documento tecnico da plataforma. Descreve as decisoes que sustentam o produto e
o porque de cada uma. Onde uma decisao tem custo, o custo esta escrito.

---

## 1. Visao em camadas

```
Presentation      src/app, src/components
       |          Componentes e rotas. Nao conhecem Firebase.
       v
Application       src/providers, src/features
       |          Estado de sessao, workspace e casos de uso.
       v
Domain            src/types, src/config, src/lib/rules, src/lib/ai
       |          Entidades, regras e politicas. Zero dependencia de infra.
       v
Infrastructure    src/lib/firebase, src/lib/auth, src/services
       |          SDK, conversao de dados, repositorios.
       v
Firebase / integracoes externas
```

A regra que mantem isso honesto: **nenhum arquivo em `src/types`, `src/config`
ou `src/lib/rules` importa de `firebase/*`**. A conversao entre `Timestamp` do
Firestore e string ISO-8601 acontece em `src/lib/firebase/converters.ts` e em
nenhum outro lugar.

Consequencia pratica: o motor de regras, a matriz de permissoes e a
configuracao de profissoes sao testaveis sem SDK, sem emulador e sem rede — e e
por isso que a suite de testes roda em menos de meio segundo.

---

## 2. Estrutura de pastas

```
src/
├── app/                      Rotas (App Router)
│   ├── (app)/                Grupo autenticado — nao aparece na URL
│   │   ├── layout.tsx        AppShell (sidebar + header + guarda)
│   │   ├── dashboard/
│   │   ├── agenda/
│   │   ├── clientes/
│   │   ├── mensagens/
│   │   ├── financeiro/
│   │   ├── agente/
│   │   └── configuracoes/
│   ├── login/
│   ├── layout.tsx            Raiz: fontes, metadata, providers
│   ├── globals.css           Design tokens
│   └── page.tsx              Apresentacao publica
│
├── components/
│   ├── layout/               Shell, sidebar, header, guarda de rota
│   └── ui/                   Primitivos (Button, Card, Badge, Avatar...)
│
├── config/                   Politica do produto, como DADO
│   ├── app.ts                Constantes globais
│   ├── classifications.ts    Taxonomia de mensagens + metadata
│   ├── labels.ts             Traducao de enums para pt-BR
│   ├── navigation.ts         Itens de menu e permissao exigida
│   ├── permissions.ts        Matriz RBAC
│   ├── system-rules.ts       Regras fundamentais (Nivel 1)
│   └── professions/          Registry de profissoes
│
├── lib/
│   ├── auth/                 Adaptadores de autenticacao
│   ├── firebase/             Cliente, caminhos, conversores
│   ├── storage/              Store sobre localStorage
│   └── utils/                cn, formatadores
│
├── mocks/                    Gerador de dados ficticios
│   ├── generators/           Um gerador por area do dominio
│   ├── dataset.ts            Orquestracao
│   └── random.ts             PRNG deterministico
│
├── providers/                Contextos globais (tema, auth, workspace)
└── types/                    Dominio
```

Principio: **`config/` guarda politica, `lib/` guarda mecanismo.** Adicionar uma
profissao, um papel ou uma classificacao e editar dado em `config/`. Mudar como
o sistema decide e editar codigo em `lib/`.

---

## 3. Modelo de dados

Colecoes sob `organizations/{organizationId}`:

| Colecao         | Conteudo                                 |
| --------------- | ---------------------------------------- |
| `members`       | Vinculo usuario ↔ organizacao, com papel |
| `professionals` | Perfil de quem atende                    |
| `clients`       | CRM administrativo                       |
| `appointments`  | Agenda                                   |
| `conversations` | Caixa de entrada                         |
| `└─ messages`   | Subcolecao: mensagens da conversa        |
| `transactions`  | Financeiro                               |
| `aiRules`       | Regras do agente, dos quatro niveis      |
| `aiDecisions`   | Registro imutavel de cada decisao        |
| `notifications` | Alertas                                  |
| `auditLogs`     | Trilha append-only                       |

Na raiz, `accounts/{userId}` define papel de plataforma, profissao, modulos,
validade e troca obrigatoria de senha. Apenas o backend escreve nessa colecao.
`initialPasswords/{userId}` guarda verificadores temporarios, sem acesso cliente.
`userMemberships/{userId}` responde "de
quais organizacoes este usuario participa?" sem exigir uma `collectionGroup`
query — que as Security Rules teriam dificuldade de restringir com seguranca.

**Decisoes de modelagem**

- **Datas como string ISO-8601 no dominio.** Serializaveis entre Server e Client
  Components, e o dominio nao importa `Timestamp`.
- **Dinheiro em centavos inteiros.** Nenhum ponto flutuante atravessa a camada
  financeira. `Money = { amountInCents, currency }`.
- **`organizationId` repetido dentro de cada documento.** Redundante em relacao
  ao caminho, mas permite `collectionGroup` com filtro de tenant e serve de
  verificacao extra nas Security Rules.
- **Desnormalizacao pontual.** `Appointment` guarda `clientName` e
  `professionalName`; `Conversation` guarda `clientName`. Evita N+1 leituras na
  listagem — o padrao de custo do Firestore penaliza join, nao duplicacao.
- **`messages` como subcolecao de `conversations`.** E a colecao que mais cresce
  e quase sempre e lida por conversa.
- **Campos de integracao ja previstos.** `Appointment.externalCalendar` e
  `Transaction.gateway` nascem nulos, para que Google Calendar e gateways de
  pagamento nao exijam migracao de dados depois.

---

## 4. Multi-tenancy

A organizacao e a unidade de isolamento. **Um profissional autonomo tambem tem
uma organizacao** — de um unico membro. Isso evita dois modelos de dados
distintos e faz de "autonomo virou clinica" apenas o convite de novos membros.

Tres camadas de isolamento, nesta ordem de confianca:

1. **Caminho.** Todo dado vive sob `organizations/{orgId}/...`. Os caminhos sao
   construidos exclusivamente por `src/lib/firebase/paths.ts` — nenhum servico
   monta string a mao, entao nao ha como esquecer o prefixo do tenant.
2. **Security Rules.** `isMember(orgId)` verifica a existencia e o status do
   documento de membro antes de qualquer leitura. Esta e a barreira real.
3. **Campo no documento.** `belongsToOrg()` confere que o `organizationId`
   gravado bate com o caminho.

O frontend nao participa do isolamento. Esconder um item de menu e conveniencia
de interface; negar o dado e seguranca.

---

## 5. Security Rules

Arquivo: [`firestore.rules`](../firestore.rules).

Garantias implementadas:

- **Negar por padrao.** O ultimo bloco recusa tudo o que nao foi liberado.
- **RBAC espelhando `src/config/permissions.ts`.** OWNER, ADMIN, PROFESSIONAL,
  ASSISTANT, VIEWER, com as mesmas fronteiras dos dois lados.
- **Regras fundamentais realmente imutaveis.** Um documento com
  `immutable == true` recusa `update` e `delete` para qualquer papel, inclusive
  OWNER. E isso que transforma "Nivel 1" de convencao da interface em garantia.
- **Auditoria append-only.** `aiDecisions` e `auditLogs` aceitam `create` e
  negam `update`/`delete` sem excecao. Um registro alteravel nao seria auditoria.
- **Mensagens imutaveis.** Preservar o que foi dito e o que permite auditar as
  decisoes do agente depois.
- **Atendimento nao e apagado.** Cancelamento e `update` de status, preservando
  historico financeiro.
- **Notificacao com escrita restrita por campo.** O usuario marca como lida; nao
  reescreve o alerta.

**Custo assumido:** `isMember()` e `roleOf()` executam `get()` no documento de
membro, e cada `get()` conta como leitura. Em troca, o isolamento nao depende de
nada que o cliente envie. E o trade-off correto.

**Limitacao conhecida:** nao ha como compartilhar codigo entre TypeScript e CEL.
`firestore.rules` e `src/config/permissions.ts` precisam ser alterados juntos;
`src/config/permissions.test.ts` documenta os invariantes que ambos respeitam.

---

## 6. AI Decision Engine

```
Mensagem
   ↓ classificacao (com confianca)
   ↓ regras SECURITY      ← nunca ultrapassadas
   ↓ regras SYSTEM        ← comportamento invariante do agente
   ↓ regras PROFESSION    ← template da profissao
   ↓ regras PROFESSIONAL  ← criadas pelo usuario
   ↓ regras CONTEXTUAL    ← condicionais
   ↓ preferencias
   ↓ permissoes do papel responsavel
RESPONDER  ou  ESCALAR
   ↓
AIDecision persistida (sempre)
```

**Trava central do produto:** apenas mensagens classificadas como
`ADMINISTRATIVE` podem receber resposta automatica. Isso nao esta espalhado em
condicionais — esta em `CLASSIFICATION_META[...].autoResponseEligible`, uma
tabela que o motor consulta. Duas suites de teste protegem esse invariante:

- `professions.test.ts` garante que nenhuma profissao habilita outra
  classificacao elegivel;
- `dataset.test.ts` garante que nenhuma decisao gerada responde fora do
  administrativo.

**Rastreabilidade.** Toda resposta e todo escalonamento produzem exatamente um
`AIDecision`, com classificacao, confianca, lista de regras avaliadas (incluindo
as que _nao_ casaram), acao, motivo legivel, versao do motor e latencia. As
regras fundamentais aparecem na trilha mesmo quando nao bloqueiam nada, porque a
auditoria precisa mostrar que foram verificadas.

**A IA tambem trabalha para o profissional.** Classificacao de risco interrompe
a automacao, gera alerta `CRITICAL` e aguarda o humano.

---

## 7. Rules Engine

Seis niveis de precedencia (`RULE_LEVEL_PRECEDENCE`, menor = maior prioridade):

| Nivel          | Quem define | Editavel |
| -------------- | ----------- | -------- |
| `SECURITY`     | Plataforma  | Nao      |
| `SYSTEM`       | Plataforma  | Nao      |
| `PROFESSION`   | Template    | Nao      |
| `PROFESSIONAL` | Usuario     | Sim      |
| `CONTEXTUAL`   | Usuario     | Sim      |
| `PREFERENCE`   | Usuario     | Sim      |

A especificacao fala em tres niveis na interface e seis camadas de precedencia.
Modelamos as seis, porque e a precedencia que o motor resolve; a interface
agrupa `SECURITY` + `SYSTEM` como "regras fundamentais".

**Regras sao estruturadas, nao prompt.** Uma regra tem `conditions` (campo,
operador, valor) e `actions` (tipo, payload) avaliaveis. Texto livre entra como
`RuleDraft`, passa por validacao e por confirmacao humana antes de virar
`AIRule` — o texto original fica em `naturalLanguageInput` para referencia, nunca
como instrucao concatenada.

**Versionamento.** Cada alteracao incrementa `version`, e a decisao registra a
versao da regra aplicada. Sem isso, uma decisao antiga seria ininterpretavel
depois que a regra mudasse.

---

## 8. Estrategia de profissoes

O nucleo **nao conhece profissao**. Toda diferenca vem de
`src/config/professions/definitions.ts`, uma tabela de dados que define, por
profissao: terminologia, duracao e preco padrao, modalidades, taxonomia de
classificacao habilitada, perfil de sensibilidade de dados, regras sugeridas,
flags de funcionalidade e cor de destaque.

Adicionar uma profissao = acrescentar uma entrada nessa tabela. Nenhum
componente, servico ou motor muda.

**Terminologia.** Guardamos as quatro formas de cada termo (`Paciente`,
`Pacientes`, `paciente`, `pacientes`) em vez de capitalizar em runtime:
capitalizacao automatica em pt-BR produz resultados ruins no meio de frase e o
custo de armazenar e zero.

**Cor de destaque.** O `AppShell` aplica `data-accent` no topo da arvore e os
componentes usam `--accent`. Nenhum componente recebe a profissao como prop para
decidir cor.

**Teste de sanidade da abstracao:** se algum dia for necessario um
`if (profissao === X)` fora de `src/config/professions/`, o dado que falta deve
virar um campo da tabela.

---

## 9. Autenticacao

`AuthAdapter` (`src/lib/auth/types.ts`) e o unico contrato que a aplicacao
conhece. Duas implementacoes:

- **`firebaseAuthAdapter`** — usado quando ha `NEXT_PUBLIC_FIREBASE_*`
  configurado. Traduz os codigos de erro do Firebase para mensagens em pt-BR sem
  vazar detalhe interno.
- **`demoAuthAdapter`** — usado quando nao ha configuracao ou quando
  `NEXT_PUBLIC_DEMO_MODE=true`. Valida senhas contra hashes PBKDF2 de contas
  locais, exige troca inicial e simula o cadastro administrativo. Essa validacao
  nao e uma barreira contra quem controla o navegador.

O modo e escolhido uma vez, em `src/lib/auth/index.ts`. Isso e o que permite
clonar o repositorio e navegar no prototipo sem criar projeto no Firebase.
O administrador local deve ser gerado com `node scripts/create-demo-admin.mjs`.
O verificador fica em `.env.local` e a senha inicial em `.local/`, fora do Git.

Na autenticacao real, o perfil vem de `accounts/{uid}` por assinatura Firestore;
email nao determina papel. As functions em `functions/` gerenciam o cadastro e
a troca inicial. Sua implantacao depende de Blaze e ainda esta pendente.
Consulte [FIREBASE-SETUP.md](FIREBASE-SETUP.md) para o estado remoto confirmado.
O repositorio operacional ainda e local, mesmo com Auth configurado.

**Guarda de rota.** Com export estatico nao existe middleware, entao
`RequireAuth` redireciona no cliente. Isso e suficiente porque a barreira real
sao as Security Rules — a rota escondida e conveniencia, o dado negado e
seguranca.

**Estado do cliente sem efeitos.** Preferencias persistidas (tema, profissao)
usam `useSyncExternalStore` sobre um store de `localStorage`
(`src/lib/storage/preference-store.ts`). Ler storage no render quebraria a
hidratacao; corrigir com `useEffect` + `setState` provocaria render em cascata —
que e justamente o que a regra `react-hooks/set-state-in-effect` do React
Compiler proibe. `useSyncExternalStore` resolve os dois casos.

---

## 10. CI/CD

Dois workflows:

- **`ci.yml`** — em todo push e PR: `npm ci` → lint → type-check → testes →
  build → artefato. Roda em fork sem segredos, porque o build sai em modo
  demonstracao quando as variaveis publicas estao ausentes.
- **`deploy.yml`** — em `main`: repete a verificacao e publica. As **Security
  Rules vao antes do Hosting**: se as regras falharem, a versao nova do frontend
  nao entra no ar com o banco ainda desprotegido.

O contexto `secrets` nao existe no `if` de um job, entao a checagem de
credenciais vira uma saida de step. Sem segredos o workflow termina com sucesso
e apenas registra que o deploy foi pulado.

Segredos ficam em GitHub Secrets. As variaveis `NEXT_PUBLIC_FIREBASE_*` nao sao
credenciais — sao identificadores publicos que vao no bundle de qualquer
aplicacao Firebase.

---

## 11. Dados administrativos vs dados sensiveis

Separacao obrigatoria, decidida na arquitetura e nao adiada para depois:

- `Client` e o **CRM administrativo**. `administrativeNotes` e explicitamente
  administrativo (preferencia de horario, forma de pagamento, estacionamento).
- **Nao existe prontuario clinico no MVP.** `ProfessionFeatureFlags.clinicalRecords`
  marca quais profissoes vao precisar do modulo, que tera controles proprios.
- **O agente nao copia conversa para o cadastro.**
  `PrivacySettings.blockConversationToCrmCopy` vem ligado por padrao.
- Classificacoes marcadas como `sensitive` na taxonomia nao alimentam o CRM.

**Sobre conformidade:** o projeto e descrito como _arquitetado considerando
principios de privacidade e protecao de dados_. Nao ha afirmacao de adequacao a
LGPD — isso exige validacao tecnica e juridica que este estagio nao contempla.
Nenhum dado real e usado em lugar nenhum.

---

## 12. Decisao: export estatico

`next.config.ts` usa `output: "export"`.

**Por que.** O prototipo e inteiramente client-side. Firebase Auth e Firestore
falam direto do navegador com o Firebase, e a barreira de seguranca sao as
Security Rules, nao um servidor intermediario. O `next build` produz HTML/CSS/JS
em `out/`, que o Firebase Hosting serve no plano gratuito, sem Cloud Functions.

**Custo aceito nesta fase:** sem Route Handlers, sem proxy/middleware, protecao
de rota no cliente e `next/image` sem otimizacao no servidor.

**Saida.** Quando a Fase 3 exigir webhooks (n8n, WhatsApp), a saida volta a ser
server-side e o deploy passa a usar a integracao de frameworks do Firebase ou
Cloud Run. Nenhum codigo de dominio muda — apenas `next.config.ts` e o alvo de
deploy.
