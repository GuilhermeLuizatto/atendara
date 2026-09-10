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
├── notificationDeliveries/{deliveryId}  fila de saida dos avisos ao cliente
└── auditLogs/{logId}                    append-only

platformPlans/{planId}                    cobranca DA PLATAFORMA (Etapa 3)
platformSubscriptions/{organizationId}    uma por organizacao — o id E o tenant
platformInvoices/{invoiceId}              cada cobranca emitida
platformGatewayEvents/{eventId}           trilha dos eventos; garante idempotencia
platformCustomers/{customerId}            indice cliente-do-gateway -> organizacao
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

---

## 2. Datas: `Timestamp` no banco, ISO no dominio

O dominio trabalha com string ISO-8601. O banco grava `Timestamp`. A conversao
acontece exclusivamente em
[`src/lib/firebase/converters.ts`](../src/lib/firebase/converters.ts), que
mantem a tabela de quais campos sao data:

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
| `auditLogs`     | + `occurredAt`                                             |

**Por que `Timestamp` e nao string.** E o tipo que o Firestore ordena, indexa e
exporta nativamente; politicas de TTL, comparacao com `request.time` nas
Security Rules e leitura no console dependem dele.

**Por que uma tabela e nao inferencia.** Adivinhar por sufixo ("tudo que termina
em `At`") transformaria qualquer campo de texto futuro em data silenciosamente.

Duas excecoes propositais: `externalCalendar.syncedAt` e `gateway` sao payloads
espelhados de sistemas externos e ficam como vieram.

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

## 4. Consultas e limites

Definidas em [`src/services/firestore/queries.ts`](../src/services/firestore/queries.ts).

| Colecao         | Ordenacao              | Teto |
| --------------- | ---------------------- | ---- |
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

O contrato entrega o tenant inteiro; os tetos existem para que uma organizacao
antiga nao transforme a primeira carga em uma conta inesperada. As colecoes que
crescem sem parar vem das mais recentes para as mais antigas. Paginar por
colecao e a evolucao natural e **nao muda a interface do repositorio**.

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
- trilha de eventos: so a operadora le;
- indice `platformCustomers`: ninguem le, em papel nenhum;
- escrita em qualquer das cinco colecoes — negada para todos, **inclusive** o
  administrador da plataforma.

A Etapa 4 acrescentou 12 verificacoes da fila de avisos. A revisao de seguranca
de 10/09/2026 acrescentou 3: membro com papel `OWNER` alcanca a cobranca so com
o vinculo **ativo** — suspenso nao le a assinatura nem as faturas.

Total: **118 verificacoes**. O numero e conferido por `assert` no proprio
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
assunto dela.

---

## 8. O que ainda nao existe

- **Conversas nao tem origem externa.** Nao ha WhatsApp, SMS nem e-mail
  conectados, entao uma organizacao real comeca com a caixa de entrada vazia. O
  simulador do agente continua funcionando para quem tem o modulo `agente`.
- **Sem migracao de dados demonstrativos.** O conjunto ficticio vive em memoria
  e nao e copiado para o Firestore — de proposito.
- **Administrador da plataforma nao tem tenant operacional.** Sua conta nao tem
  organizacao; ele continua vendo o conjunto demonstrativo, por profissao, sem
  tocar em dado de cliente nenhum. **Isso descreve a interface, nao as regras:**
  `isMember()` e `hasRole()` devolvem verdadeiro para `PLATFORM_ADMIN` em
  qualquer organizacao, entao as Security Rules concedem a ele leitura e escrita
  em todos os tenants.
