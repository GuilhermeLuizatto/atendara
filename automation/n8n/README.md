# Ponte com o n8n — n8n local (Fase 3, 13.3)

Este diretório sobe um **n8n descartável na sua máquina** para exercitar o
contrato entre o Atendara e o executor, com o **provedor fictício**. Nenhuma
mensagem real sai, e nenhuma credencial da Meta, do Google ou da AWS entra aqui.

Isto **não é a VPS**. O endurecimhttps://github.com/GuilhermeLuizatto/atendaraento do servidor de verdade — HTTPS, firewall,
atualização, backup, rotação de segredos — é a etapa H.8.

## O que é o contrato

```text
Atendara  ──(1) tarefa assinada com o segredo A ──►  n8n  ──►  canal (fictício)
        ◄──(2) resultado assinado com o segredo B ──┘
```

1. **Ida:** `automationTasks` → despachante → `POST` no webhook do n8n, com
   `x-atendara-timestamp` e `x-atendara-signature` (HMAC-SHA256 de
   `horário.corpo`), válidos por 5 minutos. A tarefa leva só o mínimo: id,
   organização, tentativa, canal, destino, texto do modelo, chave de
   idempotência e validade.
2. **Volta:** o n8n chama `automationCallback` com o resultado, assinado com o
   **segredo B**. A function confere assinatura, janela, formato e, contra a
   tarefa do banco, organização, tentativa, estado e prazo.

Entre os dois, a tarefa fica em `DISPATCHED` e o aviso em `SENDING`: **aceitar
não é enviar**.

## Subir o n8n local

1. Crie o arquivo `.env` **neste diretório** (o `.gitignore` recusa o arquivo):

```bash
ATENDARA_TASK_SECRET=segredo-de-desenvolvimento-a
ATENDARA_CALLBACK_SECRET=segredo-de-desenvolvimento-b
ATENDARA_CALLBACK_URL=http://host.docker.internal:5001/demo-atendara/southamerica-east1/automationCallback
ATENDARA_META_VERIFY_TOKEN=troque-por-um-segredo-aleatorio-longo
ATENDARA_INBOUND_CALLBACK_URL=https://southamerica-east1-SEU-PROJETO.cloudfunctions.net/inboundWebhook
```

Os valores são inventados e valem só na sua máquina. **Nunca** use aqui os
segredos do Secret Manager, e nunca deixe os dois iguais.

2. Suba:

```bash
docker compose -f automation/n8n/docker-compose.yml up -d
```

3. Abra `http://localhost:5679`, crie o usuário local e importe
   `atendara-ponte.json` em **Workflows → Import from File**.
4. Ative o fluxo. O webhook fica em
   `http://localhost:5679/webhook/atendara-ponte`.

A porta é **5679** de propósito: outro n8n na máquina costuma usar a 5678, e
este sobe com volume e projeto próprios, sem encostar nele.

## Exercitar sem esperar a agenda

Com os emuladores de pé (as suítes de `npm run test:emulator` os sobem sozinhas), o caminho completo é: criar um
atendimento com aviso planejado, deixar a fila disparar e ver a tarefa ir e
voltar. Para testar só a ponte, o teste automatizado já cobre cada recusa:

```bash
npx vitest run functions/automation-callback.test.js src/lib/automation/bridge.test.ts
```

## Homologação isolada sem publicar o app Meta

```bash
npm run test:whatsapp:sandbox
```

Requer Docker em execução, Java 21, as dependências da raiz e de `functions/`,
e a CLI Firebase instalada em `.local/firebase-tools`. O comando aproveita o
JDK de `.local/jdk` quando `JAVA_HOME` não está definido.

O teste inicia o Firestore com projeto `demo-atendara`, cria um n8n temporário
em uma porta local livre e importa os dois workflows versionados. Na cópia do
workflow de saída, apenas o endereço da Cloud API é substituído por um
servidor fictício. Nenhum token real é lido e nenhuma mensagem sai para a Meta.
As assinaturas usam segredos descartáveis gerados para aquela execução.

São exercitados desafio de conexão, assinaturas inválidas, mensagem
administrativa, risco, reentregas concorrentes, lista de destinatários de
teste, isolamento de organizações, `SAIR`, saída por modelo, callback e
recusa do provedor. O backend usa os handlers reais de entrada e callback.
Os testes partem de tarefas já entregues ao executor; não substituem a
validação do agendamento e do despachante em `dispatch.test.ts`.

Ao terminar, o comando remove seu contêiner, seus arquivos temporários e seus
dados fictícios. O n8n existente não é alterado. O resumo fica em
`.local/whatsapp-sandbox-result.json`. O servidor de callback abre uma porta
temporária no host para permitir acesso pelo Docker Desktop.

Isso comprova o contrato local, não entrega/leitura real nem aprovação do
remetente pela Meta. A fase 3B continua com homologação externa pendente.

## Destinos fictícios

O fluxo decide o resultado pelo destino, igual ao provedor simulado:

| Destino | Resultado |
|---|---|
| `+550000000001` / `recusado@exemplo.invalid` | recusa definitiva, sem nova tentativa |
| `+550000000002` / `indisponivel@exemplo.invalid` | falha temporária sempre |
| `+550000000003` / `instavel@exemplo.invalid` | falha na 1ª tentativa, aceita na 2ª |
| `+550000000004` / `limitado@exemplo.invalid` | limite de taxa |
| qualquer outro | aceito |

DDD 00 não existe no Brasil e `.invalid` é reservado pela RFC 2606: nenhum deles
chega a uma pessoa.

## O que este fluxo não faz

- **Não lê o banco.** O n8n não tem conta de serviço nem credencial do Firestore.
- **Não escreve na trilha.** Auditoria e alerta são gravados pelo Atendara, na
  mesma transação que muda o estado da tarefa.
- **Não guarda execução bem-sucedida.** O corpo da tarefa tem contato de
  paciente; histórico no n8n seria uma cópia dele fora do Firestore. Só falha
  fica, por 24 horas.
- **Não decide nada.** Consentimento, canal, profissão, antecedência e
  disponibilidade são conferidos no servidor do Atendara imediatamente antes de
  a tarefa sair.

---

## O fluxo do WhatsApp (13.4)

`atendara-whatsapp.json` é o mesmo contrato do fluxo fictício, com a chamada
real da Cloud API no meio. Ele espera o token de usuário do sistema no `.env`:

```bash
ATENDARA_META_TOKEN=cole-aqui-o-token-da-meta
```

O `ATENDARA_META_TOKEN` é **segredo**: em produção ele vive no Secret Manager e
chega ao n8n pela configuração do servidor, nunca por arquivo versionado. O
Phone Number ID segue em cada tarefa assinada pelo Atendara, depois de validado
e aprovado para a organização; não use um ID global no n8n.

**O que o fluxo faz e o que ele não faz:**

- traduz o modelo aprovado que veio do Atendara (`template`) para o formato de
  `components` da Meta, e recusa a tarefa que chegar **sem modelo** — fora da
  janela de 24 horas a Meta só entrega modelo, e lembrete nunca acontece dentro
  dela;
- traduz o erro da Meta para um código **nosso** (`INVALID_DESTINATION`,
  `SENDER_NOT_ALLOWED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`). A mensagem
  dela costuma repetir o número, que é contato de paciente, e por isso nunca é
  copiada. O código Meta `130497` vira `SENDER_NOT_ALLOWED`: ele indica uma
  restrição da conta remetente para o país do destinatário, não um telefone
  inválido;
- **não** escolhe destinatário, texto ou horário: isso o Atendara já decidiu.

⚠️ **O fluxo ainda não foi exercitado contra a Meta.** A conta de desenvolvedor
da Meta pode ser usada em modo de teste por uma pessoa física, com o número de
teste e destinatários de teste autorizados no painel. Esse caminho não depende
de domínio nem de CNPJ, mas o remetente de teste pode ser de outro país. Se a
Meta devolver `130497` ao falar com um número brasileiro, isso é uma restrição
geográfica do remetente de teste; não adianta repetir nem trocar o cadastro do
destinatário.

O modo de teste não equivale à produção: o número de teste é limitado, os
destinatários precisam ser adicionados à lista da Meta e o token é temporário.
Para operar um número próprio em produção, a Meta pode exigir verificação da
empresa, aprovação do remetente e dos modelos de mensagem. Isso deve ser
tratado depois da validação local.

## Preparação do teste da Meta como pessoa física

1. Crie um aplicativo do tipo **Business** no painel de desenvolvedores da Meta
   usando sua conta pessoal.
2. Adicione o produto **WhatsApp** e use o número de teste fornecido pela Meta.
3. Cadastre o seu celular como destinatário de teste. O celular usado no teste
   deve estar no formato internacional, por exemplo `+5513999990000`.
4. Configure um token de usuário do sistema com acesso somente aos ativos de
   teste necessários. Coloque-o em uma cópia local de `.env.example` chamada
   `.env` neste diretório. O `.gitignore` já impede o commit desse arquivo.
5. No Atendara, registre o remetente em modo `TEST` com o mesmo destinatário
   permitido. O cadastro é uma operação de operadora e exige segundo fator;
   nenhuma credencial da Meta é salva no Firestore.
6. Use um modelo aprovado pela Meta. O fluxo recusa tarefas sem modelo porque
   mensagens fora da janela de 24 horas não podem ser texto livre.

## Entrada de mensagens da Meta (13.5)

Importe `atendara-whatsapp-inbound.json` em **Workflows → Import from File**.
O workflow fica inativo até você ativá-lo. Ele registra o mesmo caminho para
`GET` e `POST`: o `GET` confere `hub.verify_token` e devolve `hub.challenge`; o
`POST` preserva o corpo bruto e `X-Hub-Signature-256`, assina o repasse com
`ATENDARA_CALLBACK_SECRET` e só confirma `200` à Meta quando
`inboundWebhook` respondeu com sucesso.

Na configuração de Webhooks do app Meta, informe a URL HTTPS pública do n8n:

```text
https://SEU-N8N/webhook/atendara-whatsapp-inbound
```

Use como Verify Token o mesmo valor configurado em
`ATENDARA_META_VERIFY_TOKEN` no servidor n8n. Assine o campo `messages` na
configuração do produto WhatsApp. O token de verificação não é o token da Cloud
API. O App Secret da Meta **não** vai para o n8n: configure-o apenas como
`META_APP_SECRET` no Secret Manager das Functions. Configure o mesmo segredo
de ponte em `ATENDARA_CALLBACK_SECRET` no n8n e `N8N_CALLBACK_SECRET` nas
Functions; a URL `ATENDARA_INBOUND_CALLBACK_URL` aponta para a function
`inboundWebhook` publicada.

O endpoint do Atendara confere novamente as duas assinaturas sobre os bytes do
corpo recebido, encontra a organização pelo `phone_number_id` cadastrado e
deduplica mensagens repetidas. O n8n não classifica nem vincula a mensagem a
uma pessoa. Mantenha execuções bem-sucedidas desativadas; execuções com falha
podem conter o corpo e o telefone recebidos, então limite a retenção e o acesso
ao banco do n8n (24 horas no compose local).

A busca do remetente exige o índice ascendente de grupo de coleção para
`messagingSenders.providerSenderId`, declarado em `firestore.indexes.json`.
Publique esse índice e aguarde o estado `READY` antes de testar a entrada.
Sem ele, o Firestore recusa a consulta e o webhook retorna erro mesmo com as
duas assinaturas corretas. O emulador não reproduz essa exigência de índice.

O fluxo está versionado e tem teste local de estrutura, desafio e HMAC, mas a
validação real exige ativá-lo num n8n com HTTPS público e concluir a verificação
no painel Meta. O n8n local em `localhost:5679` não é callback público e não
serve para essa etapa sem um túnel HTTPS controlado.

O teste fica pronto quando uma tarefa assinada pelo Atendara chega ao n8n, a
Cloud API aceita o modelo e o retorno assinado atualiza a tarefa. Ainda não
publique Functions nem use contatos reais antes de concluir esse teste.
