# Modelo de dados operacional no Firestore

Documento da Etapa 1 do roadmap. Descreve como agenda, clientes, mensagens e
financeiro ficam gravados, o que deliberadamente **nao** e gravado, e como o
isolamento entre organizacoes e provado.

Complementa [ARCHITECTURE.md](ARCHITECTURE.md); nao repete o que ja esta la.

---

## 1. Onde cada coisa vive

Todos os caminhos saem de [`src/lib/firebase/paths.ts`](../src/lib/firebase/paths.ts).
Nenhum servico monta string de path.

```
accounts/{userId}                        autoridade de acesso (so backend escreve)
initialPasswords/{userId}                verificador temporario (cliente nunca le)
userMemberships/{userId}                 indice de organizacoes do usuario

organizations/{orgId}
├── members/{userId}                     papel e situacao dentro da organizacao
├── professionals/{userId}               perfil de quem atende
├── clients/{clientId}                   CRM administrativo
├── appointments/{appointmentId}         agenda
├── conversations/{conversationId}       caixa de entrada
│   └── messages/{messageId}             subcolecao, imutavel
├── transactions/{transactionId}         financeiro
├── aiRules/{ruleId}                     apenas os niveis editaveis
├── aiDecisions/{decisionId}             append-only
├── notifications/{notificationId}       alertas DENTRO do painel
├── notificationDeliveries/{deliveryId}  fila de saida dos avisos ao cliente (so backend escreve)
├── automationTasks/{taskId}             fila de automacao (so backend le e escreve)
├── auditLogs/{logId}                    append-only (so o backend pseudonimiza)
└── privacyRequests/{requestId}          pedidos de titulares atendidos (so backend)

platformPlans/{planId}                    cobranca DA PLATAFORMA (Etapa 3)
platformSubscriptions/{organizationId}    uma por organizacao — o id E o tenant
platformInvoices/{invoiceId}              cada cobranca emitida
platformGatewayEvents/{eventId}           trilha dos eventos; garante idempotencia
platformCustomers/{customerId}            indice cliente-do-gateway -> organizacao
platformAccessGrants/{organizationId}     concessao manual vigente, uma por organizacao
platformAuditLogs/{logId}                 trilha append-only dos atos da operadora
platformRateLimits/{callable_uid}         contador de abuso por usuario (so backend)
```

`messages` e subcolecao porque e a colecao que mais cresce e quase sempre e lida
por conversa. As demais sao colecoes diretas da organizacao.

As colecoes `platform*` sao a excecao deliberada a "tudo vive sob
`organizations/`": elas nao pertencem a tenant nenhum, e sim a operadora. Sao a
mensalidade que a Three Devs cobra dos assinantes, e **nunca** viram
`transactions` de uma organizacao. O mecanismo esta em
[`functions/billing.js`](../functions/billing.js) e a politica de acesso em
[`src/lib/billing/policy.ts`](../src/lib/billing/policy.ts).

Diferenca de forma que vale registrar: os documentos `platform*` guardam datas
como **string ISO**, e nao `Timestamp`. Eles seguem a convencao de
`accounts/{userId}` — colecoes de raiz, escritas apenas pelo backend, que ja
carregam `accessUntilMs` numerico para o que as Security Rules precisam
comparar. A tabela de conversao da secao 2 cobre so as colecoes de tenant.
A excecao e `expiresAt`, gravado como `Timestamp` em `platformGatewayEvents` e
`platformRateLimits` porque politica de TTL so le esse tipo. So
`platformRateLimits` tem TTL ligado (`firestore.indexes.json`); o prazo dos
eventos e provisorio e nao tem politica ligada.

---

## 2. Datas: `Timestamp` no banco, ISO no dominio

O dominio trabalha com string ISO-8601. O banco grava `Timestamp`. A tabela de
quais campos sao data e uma so,
[`src/lib/firebase/date-fields.ts`](../src/lib/firebase/date-fields.ts), sem SDK.
O navegador converte em
[`src/lib/firebase/converters.ts`](../src/lib/firebase/converters.ts); as
functions, que tem outro `Timestamp`, em
[`functions/firestore-dates.js`](../functions/firestore-dates.js) — o que o
backend grava na fila e o que a tela le.

| Colecao         | Campos gravados como `Timestamp`                          |
| --------------- | --------------------------------------------------------- |
| todas           | `createdAt`, `updatedAt`                                   |
| `clients`       | + `lastAppointmentAt`, `nextAppointmentAt`                 |
| `appointments`  | + `startsAt`, `endsAt`, `confirmedAt`, `cancelledAt`       |
| `conversations` | + `lastMessageAt`                                          |
| `messages`      | + `sentAt`, `readAt`                                       |
| `transactions`  | + `dueDate`, `paidAt`                                      |
| `aiRules`       | + `lastAppliedAt`                                          |
| `aiDecisions`   | + `decidedAt`, `evaluatedAt`                               |
| `notifications` | + `acknowledgedAt`                                         |
| `notificationDeliveries` | + `scheduledFor`, `lastAttemptAt`, `nextAttemptAt`, `sentAt`, `cancelledAt` |
| `automationTasks` | + `scheduledFor`, `expiresAt`, `appointmentStartsAt`, `dispatchingSince`, `completedAt` |
| `auditLogs`     | + `occurredAt`                                             |
| `privacyRequests` | + `executedAt`, `expiresAt`                              |

**Por que `Timestamp` e nao string.** E o tipo que o Firestore ordena, indexa e
exporta nativamente; politicas de TTL, comparacao com `request.time` nas
Security Rules e leitura no console dependem dele.

**Por que uma tabela e nao inferencia.** Adivinhar por sufixo ("tudo que termina
em `At`") transformaria qualquer campo de texto futuro em data silenciosamente.

Cinco excecoes propositais: `externalCalendar.syncedAt` e `gateway` sao payloads
espelhados de sistemas externos e ficam como vieram; `privacyRedaction.redactedAt`
e gravado pelo backend ja em ISO; as datas do historico de consentimento em
`clients.notificationConsent` (`granted.at`, `withdrawn.at` de cada registro por
canal) ficam em ISO porque as Security Rules conferem o formato delas e a
igualdade do historico inteiro, que nao pode mudar de tipo entre leituras; e o
`history[].at` de `automationTasks`, historico dentro do documento.

`expiresAt` de `automationTasks` e a validade da **execucao** — passado dele a
tarefa nao executa —, e nao prazo de retencao. Nenhuma politica de TTL pode ser
ligada nesse campo: apagaria a tarefa duas horas depois do horario.

**`id` vem do caminho, nunca do corpo.** Um documento com `id` divergente e lido
pelo id real.

**Dinheiro.** `amountInCents` e `priceInCents` sao inteiros. Nenhum ponto
flutuante atravessa a camada financeira, nem na gravacao.

---

## 3. O que NAO e gravado

### Regras fundamentais e de profissao

`SECURITY`, `SYSTEM` e `PROFESSION` **nao existem como documento**. Sao
materializadas de [`src/config/system-rules.ts`](../src/config/system-rules.ts)
e da tabela de profissoes a cada leitura do snapshot.

O motivo e direto: regra que nao esta no banco nao tem documento a adulterar.
A garantia de imutabilidade deixa de depender de as Security Rules acertarem
todas as bordas. Elas continuam recusando `create` nesses niveis pelo cliente,
como defesa em profundidade.

Um documento gravado com o id de uma regra semeada, ou marcado `immutable`, e
descartado na montagem — coberto por `src/services/firestore/snapshot.test.ts`.

### Agregados derivados do cadastro

`totalAppointments`, `lastAppointmentAt`, `nextAppointmentAt` e
`outstandingBalanceInCents` sao recalculados na leitura, a partir da agenda e do
financeiro ja carregados. O mesmo vale para receita vencida virar `OVERDUE`.

Os campos continuam existindo no documento como cache, mas **a leitura e a
verdade**. A alternativa seria reescrever todo cadastro afetado a cada
atendimento e a cada baixa — custo de escrita desproporcional nesta fase.
Quando isso virar Cloud Function disparada por escrita, o snapshot nao muda.

---

## 4. Consultas e paginas

Definidas em [`src/services/firestore/queries.ts`](../src/services/firestore/queries.ts).

| Colecao         | Ordenacao              | Pagina |
| --------------- | ---------------------- | ------ |
| `professionals` | `displayName`          | 50   |
| `clients`       | `fullName`             | 500  |
| `appointments`  | `startsAt` desc        | 500  |
| `conversations` | `lastMessageAt` desc   | 200  |
| `messages`      | `sentAt` desc          | 500  |
| `transactions`  | `dueDate` desc         | 500  |
| `aiRules`       | `priority` desc        | 200  |
| `aiDecisions`   | `decidedAt` desc       | 200  |
| `notifications` | `createdAt` desc       | 100  |
| `notificationDeliveries` | `scheduledFor` desc | 200 |
| `auditLogs`     | `occurredAt` desc      | 200  |

A primeira carga traz uma pagina de cada colecao, para que uma organizacao
antiga nao transforme a abertura do painel numa conta inesperada. As colecoes
que crescem sem parar vem das mais recentes para as mais antigas. Cada consulta
pede um documento a mais do que mostra: e o que preenche
`snapshot.pagination[colecao].hasMore` sem uma ida extra ao servidor.

`repository.loadMore(colecao)` soma uma pagina ao limite do listener daquela
colecao. A tela diz o que esta carregado antes de oferecer o botao — clientes
em ordem alfabetica, agenda anterior ao atendimento mais antigo, financeiro,
decisoes, conversas e trilha de auditoria.

**Custo assumido:** um listener com limite maior e outra consulta, entao os
documentos que ja estavam na tela sao cobrados de novo. A alternativa, cursor
com paginas estaticas, perderia o tempo real: editar um registro da segunda
pagina nao apareceria ate recarregar.

As listagens da operadora (cadastros, concessoes, trilha, assinaturas, faturas
e eventos) usam cursor (`src/lib/firebase/paging.ts`): sao leituras pontuais, e
a ordem vem de campo presente em todo documento (`email`, `grantedAt`,
`createdAt`, id do documento, `issuedAt`, `receivedAt`). Nenhum indice composto
novo.

### Vinculo de quem usa o painel

O repositorio tambem escuta `members/{uid}` do proprio usuario. O papel dali e
o que a sessao usa para montar as permissoes — o mesmo documento que
`hasRole()` confere nas rules. Sem isso, OWNER e ADMIN de uma clinica apareciam
no aplicativo como `PROFESSIONAL`. Ser titular vem do `ownerId` da
organizacao.

### Estado da carga

`repository.getLoadState()` separa carregando, pronto e indisponivel, para a
tela nunca mostrar "nada cadastrado" quando o que houve foi falha:

- organizacao sem documento vinda do cache: `offline`;
- organizacao sem documento vinda do servidor: `organization-missing`;
- leitura da organizacao negada: `access-denied` (validade vencida, suspensao);
- colecao que falhou por outro motivo que nao permissao: fica em `failed`, e o
  painel avisa quais areas podem estar incompletas;
- carga que passa de 12 s: `slow`, com opcao de tentar de novo.

### Mensagens por `collectionGroup`

A caixa de entrada carrega mensagens de todas as conversas em uma consulta —
um listener por conversa nao escala. A consulta filtra por `organizationId`, e
esse filtro nao e conveniencia:

> Regras nao filtram resultado. Para aprovar uma consulta, o Firestore precisa
> **provar** que todo documento retornado satisfaz a condicao. Com
> `where("organizationId","==",orgId)` a prova existe; sem ele a consulta
> inteira e recusada — nao volta um subconjunto.

E por isso que `organizationId` e repetido dentro de cada documento, embora ja
esteja no caminho.

Indice necessario (unico composto novo desta etapa), em
[`firestore.indexes.json`](../firestore.indexes.json):

```
messages | COLLECTION_GROUP | organizationId ASC, sentAt DESC
```

### Colecao negada nao derruba o workspace

`permission-denied` por colecao e resultado **esperado**: a conta pode nao ter o
modulo (`financeiro`, `mensagens`, `agente`), e a trilha de auditoria so e
legivel por administracao. Nesses casos a colecao chega vazia e o restante do
workspace carrega normalmente. Qualquer outro erro e registrado no console.

---

## 5. Como as escritas acontecem

```
plans/*.ts          decide O QUE muda   — funcao pura, testavel sem emulador
firestore-repository  decide COMO grava — lote atomico, transacao, erro
firestore.rules       decide SE pode    — a unica barreira de seguranca
```

Cada mutacao produz um **plano**: uma lista de escritas aplicada em um unico
`writeBatch`. Mensagem sem a decisao que a explica, ou cancelamento sem a baixa
da receita, seriam trilhas parciais — e auditoria parcial nao e auditoria.

**Transacao.** `setAppointmentStatus` (confirmar, cancelar, concluir) e a
escrita que duas pessoas disputam de verdade — o profissional pelo celular, a
secretaria pelo balcao. E a unica que re-le o atendimento e as receitas ligadas
a ele dentro de `runTransaction`, recalculando o plano sobre o estado do
servidor em vez do snapshot que a tela tinha em maos.

**Limitacao conhecida.** O conflito de horario e conferido contra o ultimo
snapshot: o SDK cliente nao aceita query dentro de transacao, entao duas
marcacoes simultaneas no mesmo minuto ainda passam. A checagem definitiva
pertence a uma Cloud Function. Enquanto isso, `allowDoubleBooking` continua
sendo a valvula do usuario.

---

## 6. Provisionamento de uma organizacao

`registerProfessional` cria, em um unico lote: conta, verificador de senha,
organizacao, membership e **o perfil profissional**. Sem esse ultimo a
organizacao nasceria sem quem atenda e a agenda recusaria o primeiro
atendimento — e o cliente nao pode cria-lo, porque as regras exigem papel
administrativo para escrever em `professionals`.

O documento da organizacao guarda o minimo que o cadastro conhece (nome, slug,
profissao, dono). Todo o resto — fuso, moeda, plano, configuracoes de agenda, de
agente e de privacidade — vem de
[`src/config/organization.ts`](../src/config/organization.ts) na leitura. Assim
uma organizacao criada antes de um campo existir continua valida, sem migracao
de dados e sem `undefined` chegando na interface.

O papel do membro e `PROFESSIONAL`, o mesmo que
[`src/config/permissions.ts`](../src/config/permissions.ts) aplica no cliente.
Os dois lados concordam: quem nao pode excluir lancamento nem ler a trilha de
auditoria na interface tambem nao pode no banco.

---

## 7. Isolamento: o que esta provado

Criterio da Etapa 1: *dois usuarios de organizacoes diferentes nao conseguem ler
nem modificar os dados um do outro, inclusive por chamada direta ao SDK.*

`node scripts/test-firestore-rules.mjs` no emulador cobre, alem das 26
verificacoes anteriores:

- leitura e listagem de cada colecao operacional dentro do proprio tenant;
- listagem de cada colecao operacional do outro tenant — negada;
- criacao e alteracao de documento em cada colecao do outro tenant — negada;
- `collectionGroup` de mensagens com filtro do proprio tenant — permitida;
- a mesma consulta apontada para o outro tenant — negada;
- a mesma consulta **sem** filtro de tenant — negada;
- `collectionGroup` de mensagens sem o modulo `mensagens` — negada;
- mensagem: cria, nunca altera nem apaga;
- atendimento e conversa: nao sao apagados, apenas atualizados;
- notificacao: marca como lida, nao reescreve o alerta;
- trilha de auditoria: o profissional escreve, so a administracao le;
- criacao de perfil profissional pelo aplicativo — negada.

A Etapa 3 acrescentou as colecoes de cobranca da plataforma:

- o assinante le a propria assinatura; a do vizinho — negada;
- membro que nao responde pela organizacao — negado;
- faturas com filtro do proprio tenant — permitidas; de outro tenant e **sem**
  filtro — negadas, pelo mesmo mecanismo do `collectionGroup` de mensagens;
- dono com a mensalidade **vencida**: le a propria cobranca e o catalogo, e
  continua sem alcancar o operacional — e o caminho para regularizar;
- trilha de eventos: so a operadora le, e so com segundo fator (TOTP) na sessao;
- indice `platformCustomers` e contadores `platformRateLimits`: ninguem le, em
  papel nenhum;
- concessao manual: o titular le a da propria organizacao, a operadora le todas;
- trilha `platformAuditLogs`: so a operadora le;
- escrita em qualquer colecao `platform*` — negada para todos, **inclusive** a
  operadora. Concessao e trilha sao gravadas pelas callables, na mesma transacao.

A Etapa 4 acrescentou 12 verificacoes da fila de avisos. A revisao de seguranca
de 10/09/2026 acrescentou 3: membro com papel `OWNER` alcanca a cobranca so com
o vinculo **ativo** — suspenso nao le a assinatura nem as faturas. A Etapa 5B
acrescentou 59 (operadora fora dos tenants, segundo fator, concessao, trilha da
operadora, contador de abuso).

A Etapa 5C acrescentou 12, sobre `privacyRequests`:

- o titular (`ownerId`, nascido `PROFESSIONAL`), `OWNER` e `ADMIN` ativos leem;
- membro sem responsabilidade, `OWNER` suspenso, outro tenant e a operadora com
  TOTP — negados;
- criacao, alteracao e exclusao pelo cliente — negadas para todos;
- "retirar" conteudo de uma decisao pelo cliente — negado: pseudonimizar e ato
  do backend.

A etapa de uso real acrescentou 13, sobre o titular configurar os proprios
avisos:

- o titular (`ownerId`, nascido `PROFESSIONAL`) troca `settings.notifications`
  com `updatedAt`/`updatedBy`;
- o mesmo titular trocando nome, agenda, agente, dono, ou avisos junto de outro
  campo, ou gravando avisos que nao sao mapa — negado;
- `ownerId` de uma organizacao da qual a conta nao e membro — negado;
- membro `PROFESSIONAL` que nao e titular, membro com modulo restrito,
  operadora com TOTP e titular com validade vencida — negados;
- `ADMIN` continua alterando a agenda: o caminho administrativo nao mudou.

A decisao de o titular editar o proprio horario acrescentou 3, sobre
`settings.agenda` (total entao: 205).

A Fase 3 (13.1) acrescentou 31, sobre o consentimento por canal em `clients`:

- criar com registro completo — adulto, menor com responsavel legal nos tres
  canais de uma vez, e pela recepcao (`ASSISTANT`);
- criar com menor sem responsavel, responsavel sem vinculo, adulto com
  responsavel, autor que nao e quem escreve, `SUBJECT` pelo navegador, sem meio,
  meio desconhecido, data que nao e instante, versao do texto como frase,
  registro nascido retirado, canal inexistente ou formato antigo — negado;
- alterar outro campo do cadastro sem tocar no consentimento — permitido;
- apagar o consentimento ou o historico de um canal, reescrever registro vigente
  ou retirada, registro novo sobre um vigente, retirar e autorizar na mesma
  escrita, retirar em nome de outro membro, `VIEWER` retirando — negado;
- retirar um canal, retirar os tres de uma vez e autorizar de novo depois de
  retirar — permitido, com o historico intacto;
- passar do formato antigo ao registro por canal guardando o antigo inteiro —
  permitido; perdendo ou reescrevendo o antigo — negado.

A Fase 3 (13.2) acrescentou 39, sobre a fila no servidor:

- `notificationDeliveries`: o membro com o modulo `agenda` le e lista; o titular
  `PROFESSIONAL`, `OWNER`, `ADMIN` e `ASSISTANT` criando entrega planejada,
  marcando envio, zerando tentativas ou cancelando — negado. Antes, os tres
  primeiros criavam e alteravam o resultado pelo navegador;
- `automationTasks`: titular, `OWNER` e `ADMIN` lendo, listando, criando,
  concluindo ou apagando tarefa, alerta ou trilha forjados como da automacao,
  membro sem o modulo — negado;
- listagem e escrita cruzadas entre tenants e a operadora com TOTP, tambem na
  fila de automacao — negadas.

Total: **275 verificacoes**. O numero e conferido por `assert` no proprio
script, para que uma verificacao removida por engano quebre o teste.

Do lado do dominio, `src/services/firestore/plans.test.ts` verifica que nenhum
plano de escrita produz caminho fora de `organizations/{orgId}/` — a barreira
comeca antes da rede.

### Tres suites, tres perguntas diferentes

| Comando                 | Precisa de emulador | Responde                                          |
| ----------------------- | ------------------- | ------------------------------------------------- |
| `npm test`              | nao                 | a regra de negocio esta certa?                    |
| `npm run test:rules`    | sim                 | quem pode o que? (isolamento, modulos, append-only) |
| `npm run test:repository` | sim               | a fiacao grava e le o que promete?                |
| `npm run test:access`   | sim                 | Auth, callables, webhook e regras concordam entre si? |

`npm run test:emulator` roda as tres ultimas em sequencia.

A suite de repositorio existe porque planos corretos e regras corretas ainda
deixam um vao: conversao `Timestamp` <-> ISO, lote atomico, transacao e
listeners so falham contra um banco de verdade. Ela sobe o emulador com regras
abertas (`scripts/emulator-open.rules`, nunca publicadas) — autorizacao nao e o
assunto dela. Tambem roda `functions/automation.emulator-test.js`: gatilho e
despachante contra o banco, com a Cloud Tasks e o provedor substituidos por
dubles que contam cada pedido (reentrega, tarefa vencida, consentimento retirado
entre planejar e enviar, remarcacao, nova tentativa, execucao interrompida).

A suite de acesso sobe tambem a Cloud Tasks emulada, para a fila ir do gatilho
ao despachante. Limite dela: executa a tarefa na hora, sem esperar
`scheduleTime` — por isso o caminho completo ali e o da confirmacao, que sai no
instante da escrita.

---

## 8. Eliminacao, pseudonimizacao e lapide

O destino de cada colecao esta em `PERSONAL_DATA_MAP`
([`src/config/privacy.ts`](../src/config/privacy.ts)); a visao geral fica em
[ARCHITECTURE.md](ARCHITECTURE.md), secao 14. O que muda na forma dos documentos:

- **Pedido de eliminacao de um cliente.** `clients`, `conversations` e
  `messages` do cliente sao apagados. `appointments`, `transactions`,
  `notifications`, `notificationDeliveries`, `automationTasks`, `aiDecisions`,
  `auditLogs` e `privacyRequests` ligados a ele continuam, com os campos pessoais
  trocados e
  a marca `privacyRedaction: { scope, requestId, redactedAt }`. Onde havia o
  `clientId`, fica o mesmo pseudonimo `titular-removido-{aleatorio}` em todos os
  documentos. A busca parte do `clientId` e segue os ids derivados
  (`resource.id`, `target.id`, `aiDecisionId`), porque o resumo da trilha e o
  titulo do alerta sao montados com o nome.
- **Exclusao da organizacao.** Colecoes operacionais, membros e perfis sao
  apagados, inclusive subcolecoes. `aiDecisions`, `auditLogs` e
  `privacyRequests` sao pseudonimizados e ganham `expiresAt` provisorio.
  `organizations/{orgId}` vira lapide: `{ id, deletion, expiresAt }`, sem nome,
  dono, profissao nem configuracao — as regras deixam de reconhecer qualquer
  membro. `accounts`, `initialPasswords` e `userMemberships` dos membros sao
  apagados, com o usuario do Auth. Em `platformSubscriptions`, so
  `subscriberEmail` sai; faturas, eventos, concessoes e trilha da plataforma
  ficam, com o motivo escrito no mapa.

**Indices.** Nenhum novo. As buscas por `clientId`, `subjectId`, `resource.id`,
`target.id` e `aiDecisionId` sao igualdade ou `in` em campo unico; a pagina de
mensagens da exportacao usa o indice `organizationId ASC, sentAt DESC` que a
caixa de entrada ja exige.

---

## 9. O que ainda nao existe

- **Conversas nao tem origem externa.** Nao ha WhatsApp, SMS nem e-mail
  conectados, entao uma organizacao real comeca com a caixa de entrada vazia, e
  a tela diz isso. O simulador do agente precisa de uma conversa existente: numa
  organizacao real ele explica por que nao ha o que testar, e as regras seguem
  editaveis.
- **Progresso do guia de primeiros passos fica no navegador.** Confirmar a
  profissao e o horario nao e dado da organizacao; os passos de cadastro e
  atendimento sao lidos dos proprios dados.
- **Sem migracao de dados demonstrativos.** O conjunto ficticio vive em memoria
  e nao e copiado para o Firestore — de proposito.
- **Administrador da plataforma nao tem tenant operacional.** Sua conta nao tem
  organizacao; ele continua vendo o conjunto demonstrativo, por profissao, sem
  tocar em dado de cliente nenhum. As Security Rules dizem o mesmo: a operadora
  nao passa por `isMember()`, `hasRole()` nem `moduleAccess()`, e so alcanca
  `accounts` e as colecoes `platform*`, sempre com segundo fator na sessao.
  Organizacao e vinculo sao criados pelo backend. Admin SDK e console do
  Firebase continuam passando por cima das regras.
