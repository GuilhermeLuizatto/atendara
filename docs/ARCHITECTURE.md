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
│   │   ├── financeiro/       Financeiro do NEGOCIO do assinante
│   │   ├── assinatura/       Mensalidade que o assinante paga a operadora
│   │   ├── agente/
│   │   ├── admin/            Cadastros, concessoes, cobranca e trilha da operadora
│   │   └── configuracoes/
│   ├── login/                Entrar e pedir nova senha
│   ├── redefinir-senha/      Destino do link de nova senha
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
│   ├── billing.ts            Catalogo de planos, tolerancia e indicadores
│   ├── classifications.ts    Taxonomia de mensagens + metadata
│   ├── labels.ts             Traducao de enums para pt-BR
│   ├── navigation.ts         Itens de menu e permissao exigida
│   ├── permissions.ts        Matriz RBAC
│   ├── system-rules.ts       Regras fundamentais (Nivel 1)
│   └── professions/          Registry de profissoes
│
├── lib/
│   ├── auth/                 Adaptadores de autenticacao
│   ├── billing/              Politica de acesso e indicadores (puros, sem SDK)
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
│
├── services/                 Persistencia
│   ├── billing/              Cobranca da plataforma — porta separada, de leitura
│   ├── types.ts              Contrato `WorkspaceRepository`
│   ├── aggregates.ts         Derivados puros (saldo, atraso, conflito)
│   ├── guards.ts             Permissao e validacao comuns as duas versoes
│   ├── memory/               Prototipo e demonstracao
│   └── firestore/            Producao
│       ├── plans/            O QUE muda: funcoes puras -> lista de escritas
│       ├── queries.ts        Consultas e paginas do snapshot
│       └── snapshot.ts       Montagem, regras semeadas e derivados
│
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
| `notifications` | Alertas DENTRO do painel                 |
| `notificationDeliveries` | Fila de saida dos avisos ao cliente |
| `auditLogs`     | Trilha append-only                       |
| `privacyRequests` | Registro dos pedidos de titulares atendidos |

`notifications` e `notificationDeliveries` sao coisas diferentes e o nome quase
esconde isso: a primeira e o alerta que aparece para a equipe dentro do produto;
a segunda e a mensagem que SAI para quem e atendido, com estado de entrega e
tentativas. So a segunda exige consentimento, contato valido e configuracao
explicita — as condicoes vivem em `src/lib/notifications/eligibility.ts`.

Na raiz, alem dessas, vivem as colecoes da **cobranca da plataforma** —
`platformPlans`, `platformSubscriptions/{organizationId}`, `platformInvoices`,
`platformGatewayEvents` e `platformCustomers` — e as dos atos da operadora,
`platformAccessGrants`, `platformAuditLogs` e `platformRateLimits`. Elas nao
pertencem a tenant nenhum: sao a mensalidade que a operadora cobra dos
assinantes e o registro do que ela faz, e por isso ficam fora de
`organizations/`. Ver a secao 13.

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
- **Regras fundamentais nao sao documento.** `SECURITY`, `SYSTEM` e
  `PROFESSION` sao materializadas de `src/config` a cada leitura. Regra que nao
  esta no banco nao tem o que adulterar.
- **Agregados do cadastro sao derivados na leitura.** `totalAppointments` e o
  saldo em aberto saem da agenda e do financeiro carregados, em vez de reescrever
  todo cadastro afetado a cada mutacao.

A forma exata dos documentos, as consultas, os indices e os limites estao em
[FIRESTORE-DATA-MODEL.md](FIRESTORE-DATA-MODEL.md).

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
  A pseudonimizacao a pedido do titular e do backend e nao passa pelas regras
  (secao 14).
- **Mensagens imutaveis.** Preservar o que foi dito e o que permite auditar as
  decisoes do agente depois.
- **`collectionGroup` de mensagens com filtro de tenant.** A caixa de entrada le
  todas as conversas em uma consulta. Regras nao filtram resultado: o Firestore
  so aprova a consulta porque o filtro por `organizationId` prova que todo
  documento retornado pertence a organizacao. Sem o filtro, a consulta inteira e
  recusada.
- **Atendimento nao e apagado.** Cancelamento e `update` de status, preservando
  historico financeiro.
- **Notificacao com escrita restrita por campo.** O usuario marca como lida; nao
  reescreve o alerta.
- **Titular configura os proprios avisos, e so eles.** O autonomo nasce
  `PROFESSIONAL` e dono da organizacao. `organizationHolder()` deixa o `ownerId`
  com vinculo ativo trocar `settings.notifications` — nenhum outro campo do
  documento — e espelha `ORGANIZATION_HOLDER_PERMISSIONS`. Nenhum outro membro
  ganha nada; nome, agenda e agente continuam de `OWNER`/`ADMIN`.

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
Fora do Git nao e fora do bundle: `NEXT_PUBLIC_*` vai literal para o JavaScript
publicado. Por isso `src/config/demo-admin.ts` so le o verificador em build de
demonstracao, e `npm run check:bundle` (parte do `verify`) confere o artefato.

Na autenticacao real, o perfil vem de `accounts/{uid}` por assinatura Firestore;
email nao determina papel. Dentro da organizacao, o papel da sessao vem de
`members/{uid}` — o documento que as rules conferem — e ser titular vem do
`ownerId`; `accountPermissions` cruza os dois com os modulos liberados.

**Recuperacao de senha.** `sendPasswordReset` responde igual exista a conta ou
nao, em pt-BR, e o link cai em `/redefinir-senha/` quando o modelo de e-mail do
projeto aponta para la (sem isso, a pagina padrao do Firebase faz o mesmo). A
tela confere o codigo antes de pedir a senha e exige 12 a 128 caracteres. Senha
redefinida nao dispensa a troca inicial: `mustChangePassword` so e baixado pela
callable, no servidor. As functions em `functions/` gerenciam o cadastro e
a troca inicial; as de cobranca dependem dos segredos do gateway no Secret
Manager.

O repositorio operacional escolhe a implementacao em `src/services/index.ts`:
Firestore quando ha projeto configurado E o usuario pertence a uma organizacao;
o conjunto demonstrativo em memoria nos demais casos — repositorio clonado sem
Firebase, modo demonstracao explicito e administrador da plataforma, que nao tem
tenant operacional.

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
Nenhum dado real e usado em lugar nenhum. O lado tecnico dos pedidos de titular
esta na secao 14.

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

---

## 13. Cobranca da plataforma

O Nexo e operado pela Three Devs e vendido por mensalidade. Existem dois
dinheiros no produto e a arquitetura os mantem separados por construcao, nao por
disciplina:

| | Cobranca da plataforma | Financeiro operacional |
| --- | --- | --- |
| Colecoes | `platform*` na raiz | `organizations/{orgId}/transactions` |
| Porta no codigo | `PlatformBillingClient` | `WorkspaceRepository` |
| Derivados | `src/lib/billing/metrics.ts` | `src/services/aggregates.ts` |
| Tela | `/assinatura`, `/admin` | `/financeiro` |

Nenhuma funcao de um lado recebe dado do outro. `WorkspaceRepository` nao foi
alterado nesta etapa — a cobranca entrou por uma porta propria, e nao alargando
a existente.

**A autoridade e o webhook, ou a concessao registrada.**
`accounts/{uid}.subscriptionStatus` e `accessUntil` continuam sendo o portao que
`firestore.rules` verifica. Existem exatamente duas origens dessas escritas: o
webhook do gateway e a concessao manual da operadora (`functions/platform.js`),
com segundo fator, tipo, prazo maximo, motivo e entrada em `platformAuditLogs`
na mesma transacao. O portao usa a maior validade entre as duas
(`src/lib/platform/access-gate.ts`), lida na mesma transacao pelo webhook e pelas
callables: um evento nao fecha concessao vigente, e concessao nunca encurta ciclo
pago. Nenhuma outra callable escreve esses campos — `functions/index.test.js`
varre o codigo para garantir. O
navegador nao tem caminho de escrita para nenhuma colecao `platform*`, e nenhuma
callable de cobranca aceita `organizationId` vindo do cliente — a organizacao e
lida de `accounts/{uid}` no servidor.

**A politica e compartilhada, nao duplicada.** `src/lib/billing/policy.ts` e
transpilado para `functions/generated/billing-policy.js` por
`scripts/build-functions.mjs`, do mesmo jeito que os caminhos e os enums de
acesso. O navegador usa para exibir; o backend usa para decidir. Duas copias
divergiriam.

**Idempotencia e correcao, nao otimizacao.** O gateway retenta e nao promete
ordem. `platformGatewayEvents/{eventId}` e criado na mesma transacao do efeito —
a reentrega aborta —, e cada documento afetado guarda o instante do ultimo evento
aplicado, para que um evento atrasado nao reescreva estado mais novo.

**Custo assumido:** o webhook obriga uma function HTTP (`onRequest`) porque
`output: "export"` nao tem rota de servidor, e a verificacao da assinatura exige
o corpo bruto. E a primeira dependencia de backend HTTP do produto.

---

## 14. Pedidos de titulares de dados

O lado tecnico de exportar e eliminar o que o produto guarda sobre uma pessoa.
Prazos, excecoes a eliminacao e base legal **nao** sao decididos aqui: sao
pontos juridicos em aberto, e o codigo esta marcado assim.

**O mapa e politica executavel.** `src/config/privacy.ts` diz, para cada colecao
de `paths.ts`, que campos descrevem pessoas, a retencao atual e o que acontece
na eliminacao de um cliente e na exclusao da organizacao (`DELETE`,
`PSEUDONYMIZE`, `TOMBSTONE`, `KEEP` com motivo escrito, `NOT_APPLICABLE`).
`functions/privacy.js` executa o mapa; `src/lib/privacy/redaction.ts` e a funcao
pura que transforma documento em patch. Um teste exige entrada para toda
colecao: nenhuma colecao nova entra sem decisao de privacidade.

**Cinco callables, nenhuma com `organizationId`.** A organizacao sai de
`accounts/{uid}`, como na cobranca.

| Callable | Quem chama | Efeito |
| --- | --- | --- |
| `exportClientData` | responsavel, painel aberto | JSON com cadastro, agenda, conversas, financeiro, envios, decisoes e trilha sem nome da equipe |
| `eraseClientData` | responsavel, painel aberto | apaga cadastro, conversas e mensagens; pseudonimiza o resto |
| `startOrganizationExport` | responsavel, painel aberto | registra o inicio e devolve o id exigido por toda pagina |
| `exportOrganizationPage` | quem iniciou, em ate 60 min | uma pagina de uma colecao; o servidor nao guarda arquivo |
| `deleteOrganization` | so o titular (`ownerId`), login recente, sem assinatura viva | apaga o tenant, pseudonimiza a trilha, deixa lapide, encerra contas |

"Responsavel" e papel `OWNER`/`ADMIN` ou o titular — o autonomo nasce
`PROFESSIONAL` e dono. Espelhado em `privacy:*` (`permissions.ts`) e em
`privacyResponsible()` (`firestore.rules`).

**Append-only reconciliado.** Decisoes do agente e trilha nunca sao apagadas por
pedido de titular. O backend troca so os campos pessoais listados no mapa —
nunca os de `APPEND_ONLY_PROTECTED_FIELDS` —, grava `privacyRedaction` com o id
do pedido e mantem classificacao, regras aplicadas, acao, motivo e datas. Pelo
cliente, `update` e `delete` continuam negados. O pseudonimo e aleatorio: nao
deriva do `clientId`, e o registro do pedido guarda o pseudonimo, nao o id.

**Todo pedido deixa registro.** `organizations/{orgId}/privacyRequests` (so
backend escreve; so o responsavel le) mais uma entrada `EXPORT` ou `DELETE` na
trilha, sem nome de ninguem. A exclusao da organizacao registra
`ORGANIZATION_DELETED` em `platformAuditLogs`, porque o tenant deixa de existir.

**Retencao.** Segue o criterio da Etapa 5B: `expiresAt` gravado com prazo
provisorio, TTL desligado para toda colecao com dado de pessoa. So
`platformRateLimits` tem TTL.

**Custo e limites assumidos.** Eliminacao e exclusao nao sao uma transacao unica
(podem passar de 500 escritas): dependentes primeiro, cadastro e registro por
ultimo, e repetir o pedido retoma. Nao ha tela nesta etapa. Copias fora do
Firestore — backup, arquivo baixado, gateway, provedores — nao sao alcancadas.
