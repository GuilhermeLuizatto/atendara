# Embedded Signup da Meta

Esta etapa prepara a conexão do WhatsApp Business existente com a Plataforma
do WhatsApp Business. A interface entrega o código temporário à Function
autenticada, que valida a conta e o número sem persistir a credencial da Meta.

## O que já está preparado

- aba **WhatsApp** em **Configurações**;
- carregamento do SDK oficial da Meta somente quando os identificadores estão
  configurados;
- abertura do `FB.login` com `whatsapp_embedded_signup`;
- tratamento de cancelamento e autorização recebida;
- validação server-side da WABA, do número e da inscrição para receber eventos;
- CSP com os domínios necessários;
- nenhum token ou código de autorização salvo em `localStorage`, Firestore ou
  no bundle como segredo.

## Configuração local

Copie os identificadores públicos para `.env.local`:

```env
NEXT_PUBLIC_META_APP_ID=1404570591652444
NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID=
NEXT_PUBLIC_META_GRAPH_VERSION=v25.0
```

O `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID` precisa ser criado no painel do
Meta Developers para o produto WhatsApp e para o fluxo de Embedded Signup. Ele
não é o token de acesso.

Depois de alterar `.env.local`, reinicie o servidor do Next.js. Abra
**Configurações → WhatsApp** e use **Conectar com a Meta**. A conexão somente
será iniciada quando os dois primeiros valores existirem.

## Limite atual da etapa

A Function `completeWhatsappEmbeddedSignup` troca o código no servidor, valida o
WABA e o número, inscreve o WABA no app para receber eventos e grava somente os
identificadores, nome/número exibidos, estado e auditoria no tenant.

Isso ainda não aprova o remetente em `messagingSenders` e não habilita envio
real. A aprovação continua sendo um ato separado da operadora, com segundo
fator. O cadastro só pode aprovar o mesmo Phone Number ID e o mesmo número
exibido que foram validados pelo Embedded Signup. Também não há cobrança de
conversa nesta etapa.

Para enviar pela Cloud API, o n8n usa separadamente uma credencial de usuário
do sistema da Meta, com acesso mínimo aos ativos necessários. O identificador
do número segue na tarefa assinada de cada organização; o token nunca é
armazenado no Firestore, no navegador ou no JSON versionado do fluxo.

No ambiente das Functions, configure `META_APP_ID`, `META_APP_SECRET` (Secret
Manager) e, opcionalmente, `META_GRAPH_VERSION`. O app id pode ser igual ao
valor público usado no frontend; o app secret nunca deve ir para `.env.local`
do navegador.

## Produção

Antes de publicar o fluxo, a Meta ainda exigirá uma URL pública HTTPS, domínio
configurado, política de privacidade e a configuração de permissões/revisão do
app. O domínio não é necessário para desenvolver a tela local, mas é necessário
para completar o callback e o webhook de produção.

O código e os testes automatizados não substituem a homologação ponta a ponta:
é preciso validar um envio com remetente e destinatário de teste autorizados,
validar o webhook de entrada e só então configurar n8n HTTPS, rotação de
segredos e monitoramento para o piloto. A aprovação jurídica do texto de
consentimento também continua sendo um bloqueio para envio a clientes reais.
