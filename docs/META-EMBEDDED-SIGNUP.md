# Embedded Signup da Meta

Esta etapa prepara a conexão do WhatsApp Business existente com a Plataforma
do WhatsApp Business. O protótipo não envia mensagens e não troca o código de
autorização no navegador.

## O que já está preparado

- aba **WhatsApp** em **Configurações**;
- carregamento do SDK oficial da Meta somente quando os identificadores estão
  configurados;
- abertura do `FB.login` com `whatsapp_embedded_signup`;
- tratamento de cancelamento e autorização recebida;
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

## O que ainda depende das Functions

O retorno do Meta contém um código de autorização temporário. A próxima etapa
de backend deve:

1. receber esse código por um endpoint HTTPS autenticado;
2. trocá-lo no servidor, sem expô-lo ao cliente;
3. obter e validar o WABA, o número e as permissões retornadas;
4. guardar somente os identificadores e referências necessárias no tenant;
5. registrar a auditoria append-only da conexão;
6. assinar o webhook de mensagens e status.

Até essa etapa, a interface apenas confirma que a Meta respondeu. Não existe
envio de mensagem, cobrança de conversa ou persistência de credencial.

## Produção

Antes de publicar o fluxo, a Meta ainda exigirá uma URL pública HTTPS, domínio
configurado, política de privacidade e a configuração de permissões/revisão do
app. O domínio não é necessário para desenvolver a tela local, mas é necessário
para completar o callback e o webhook de produção.
