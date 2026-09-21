# Ponte com o n8n — n8n local (Fase 3, 13.3)

Este diretório sobe um **n8n descartável na sua máquina** para exercitar o
contrato entre o Atendara e o executor, com o **provedor fictício**. Nenhuma
mensagem real sai, e nenhuma credencial da Meta, do Google ou da AWS entra aqui.

Isto **não é a VPS**. O endurecimento do servidor de verdade — HTTPS, firewall,
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
real da Cloud API no meio. Ele espera três variáveis a mais no `.env`:

```bash
ATENDARA_PHONE_NUMBER_ID=1236644296208358
ATENDARA_META_TOKEN=cole-aqui-o-token-da-meta
```

O `ATENDARA_META_TOKEN` é **segredo**: em produção ele vive no Secret Manager e
chega ao n8n pela configuração do servidor, nunca por arquivo versionado.

**O que o fluxo faz e o que ele não faz:**

- traduz o modelo aprovado que veio do Atendara (`template`) para o formato de
  `components` da Meta, e recusa a tarefa que chegar **sem modelo** — fora da
  janela de 24 horas a Meta só entrega modelo, e lembrete nunca acontece dentro
  dela;
- traduz o erro da Meta para um código **nosso** (`INVALID_DESTINATION`,
  `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`). A mensagem dela costuma repetir o
  número, que é contato de paciente, e por isso nunca é copiada;
- **não** escolhe destinatário, texto ou horário: isso o Atendara já decidiu.

⚠️ **O fluxo ainda não foi exercitado contra a Meta.** A conta de desenvolvedor
da Meta pode ser usada em modo de teste por uma pessoa física, com o número de
teste e destinatários de teste autorizados no painel. Esse caminho não depende
de domínio nem de CNPJ e é o próximo passo recomendado para validar o contrato.

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
4. Copie o `Phone number ID` e gere um token temporário somente para o teste.
   Coloque ambos em uma cópia local de `.env.example` chamada `.env` neste
   diretório. O `.gitignore` já impede o commit desse arquivo.
5. No Atendara, registre o remetente em modo `TEST` com o mesmo destinatário
   permitido. O cadastro é uma operação de operadora e exige segundo fator;
   nenhuma credencial da Meta é salva no Firestore.
6. Use um modelo aprovado pela Meta. O fluxo recusa tarefas sem modelo porque
   mensagens fora da janela de 24 horas não podem ser texto livre.

O teste fica pronto quando uma tarefa assinada pelo Atendara chega ao n8n, a
Cloud API aceita o modelo e o retorno assinado atualiza a tarefa. Ainda não
publique Functions nem use contatos reais antes de concluir esse teste.
