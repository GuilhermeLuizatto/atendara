# Google Calendar — fase 3C

Implementado: cada profissional conecta a própria conta, consulta manualmente
os próximos 30 dias da agenda principal e desconecta. Da agenda principal
entram apenas início e fim dos intervalos ocupados.

**Escrita (frente 1 da 3C, 24/09):** os atendimentos do profissional aparecem
numa agenda separada, "Atendara", criada na conta dele ao conectar. Criar,
remarcar, cancelar ou trocar o profissional de um atendimento acerta o evento
pela fila (`SYNC_CALENDAR_EVENT`); ao conectar, vão os atendimentos futuros já
marcados. O evento diz só o que o grau de exposição da profissão permite
(`calendarEventFor`), com descrição sempre vazia e visibilidade privada.
Desconectar apaga a agenda "Atendara" do Google. Conexões anteriores a esta
entrega continuam lendo ocupado e pedem reconexão para escrever.

Não há atualização automática do ocupado, bloqueio na agenda do Atendara ou
remarcação integrada. Ativada em produção e testada com conta real em
24/09/2026 — resultado na seção "Teste real de 24/09/2026".

## Configuração do ambiente de teste

1. Habilitar Google Calendar API no projeto Google Cloud e configurar a tela
   de consentimento OAuth. **Não voltar a tela para "teste" num projeto que já
   está em produção:** ela é a mesma do login com Google do painel, e só contas
   testadoras conseguiriam entrar. Em produção sem verificação, o Google mostra
   "app não verificado" (segue-se em Avançado) e limita a 100 usuários.
2. Criar um cliente OAuth do tipo aplicação Web. Cadastrar como URI de retorno
   a URL HTTPS exata da function `googleOAuthCallback` em `southamerica-east1`.
   O escopo `calendar.app.created` é sensível: o app não verificado limita a
   100 usuários e mostra o aviso de app não verificado. A verificação do app no
   Google precisa acontecer antes do piloto aberto.
3. Nas variáveis das Functions (`functions/.env.<project-id>`), preencher
   `GOOGLE_OAUTH_CLIENT_ID`, `CALENDAR_REDIRECT_URL` e `CALENDAR_KMS_KEY`
   (nome completo da CryptoKey: `projects/.../locations/.../keyRings/.../cryptoKeys/...`).
4. Guardar `GOOGLE_OAUTH_CLIENT_SECRET` e `CALENDAR_STATE_SECRET` no Secret
   Manager. O segundo deve ser aleatório e forte, separado de outros segredos.
   No emulador, usar `.secret.local`; nunca `NEXT_PUBLIC_*` ou arquivos versionados.
5. Habilitar Cloud KMS e criar uma chave simétrica, na mesma região das
   Functions (em produção: keyring `atendara`, chave `google-calendar-tokens`,
   rotação de 90 dias). Dar à conta `fn-automacao`
   acesso de criptografia/descriptografia **somente nessa chave**, além do
   acesso aos dois segredos. O material OAuth é cifrado antes de ser persistido.
6. Gerar os módulos com `node scripts/build-functions.mjs`, executar
   `npm run verify` e `npm run test:repository`. Publicar em ambiente controlado
   `startCalendarConnection`, `googleOAuthCallback`, `getCalendarConnection`,
   `refreshCalendarBusy`, `disconnectCalendar`, `calendarBusyCallback`,
   `planCalendarEvents`, `dispatchAutomationTask` (passa a usar o segredo do
   cliente OAuth) e `cleanupDeletedCalendarConnection`, além do painel. A última fecha o contrato legado que aceitava ocupado sem pedido.
   **Functions antes do painel:** o merge na `main` publica o site, e um painel
   que chama `getCalendarConnection` sem a function no ar mostra erro na aba.
   O `.env.<project-id>` usado na publicação precisa repetir as variáveis já em
   produção (por exemplo `GEMINI_*`), senão elas somem das functions publicadas.
7. Confirmar o App Check do painel. O callback OAuth é público com estado
   assinado e nonce de uso único; as demais operações exigem autenticação e
   App Check. Não são necessárias novas permissões de leitura no Firestore.

## Teste autorizado pela pessoa dona da agenda

1. Entrar como profissional ativo com módulo Agenda e perfil ligado ao usuário.
   Em Configurações → Google Calendar, clicar em Conectar e Continuar no Google.
   A pessoa escolhe a conta e concede a autorização de livre/ocupado.
2. Fechar a aba de retorno e clicar em Verificar conexão. A conexão deve aparecer
   sem nenhum token no navegador, resposta das callables ou registros.
3. Criar pessoalmente um compromisso fictício na agenda principal do Google.
   Clicar em Atualizar horários ocupados: comparar início e fim no mesmo fuso.
   A tela usa o fuso do navegador; o backend armazena ISO em UTC. O título e os
   convidados não devem aparecer no Atendara.
4. Remover o compromisso fictício e atualizar. Uma resposta bem-sucedida sem
   intervalos deve informar agenda vazia **no período consultado**.
5. Revogar o acesso no Google e atualizar: deve pedir reconexão ou mostrar falha,
   nunca atualizar a validade da leitura antiga nem afirmar que a agenda está livre.
6. Reconectar e desconectar pelo painel. Conferir apagamento da credencial,
   do ocupado e dos pedidos pendentes. Caso Google não confirme a revogação,
   o painel orienta remover também em Conta Google → Conexões.
7. Confirmar que outra pessoa, outro tenant e a operadora não podem conectar
   este perfil. Testes automatizados cobrem também revogação durante OAuth ou
   consulta, repetição do retorno e leituras fora de ordem.

O resultado automatizado com respostas fictícias não substitui este teste real.
Segredos, conta OAuth e autorização do titular são requisitos de ativação, não
evidência de que o teste já passou. A fase 3C permanece em andamento.

## Teste real de 24/09/2026

Produção (`atendo-a3481`), organização de teste "teste" (Estética), agenda
principal de uma conta Google do titular, compromisso fictício com título,
descrição e local marcados para detectar vazamento.

| Passo | Resultado |
|---|---|
| 1–2. Conectar e verificar | Passou depois de duas correções (abaixo) |
| 3. Consultar com o compromisso | Passou: 1 intervalo, 26/09 14:00–15:30, sem título |
| Conferência no Firestore | `calendarBusyBlocks` só com `startsAt`/`endsAt` em UTC; `calendarConnections` só com `refreshTokenCiphertext` do KMS e escopo `calendar.freebusy` |
| 4. Remover e consultar | Passou: "não continha horários ocupados. Isso não confirma que a agenda continua livre" |
| 5. Revogar no Google e consultar | Passou: "Reconexão necessária", sem exibir a leitura antiga |
| 6. Reconectar e desconectar | Passou: reconexão apagou a leitura anterior; desconexão confirmou a revogação no Google, zerou a credencial e apagou `calendarBusyBlocks` |
| 7. Outra pessoa, outro tenant, operadora | **Não testado em produção.** Coberto pelos testes automatizados; a aba não aparece para administrador da plataforma |

Defeitos achados e corrigidos no caminho:

- **Token do KMS no caminho errado** (`functions/kms.js`): o pedido ao servidor
  de metadados ia para `instance/service-account/token`, que responde 404; o
  certo é `instance/service-accounts/default/token`. Todo teste simulava o KMS,
  por isso só apareceu em produção. `functions/kms.test.js` fixa o caminho.
- **Registro sem etapa:** a falha do retorno OAuth só dizia `PROVIDER_ERROR`. O
  registro passou a levar etapa, nome do erro e status HTTP, sem token, código
  ou corpo de resposta — foi o que achou o defeito acima.
- **"Leitura desatualizada" logo após consultar:** o relógio do painel avança a
  cada minuto e recusava leitura segundos à frente dele. Folga de
  `CALENDAR_CLOCK_SKEW_MINUTES` (5 min).

Em aberto: a mensagem de reconexão chega à tela com o sufixo `[503]`, que não está
no texto enviado pelo servidor; a origem no navegador ainda não foi confirmada.

## Limites e continuidade

- Estado OAuth vence em dez minutos. Nova tentativa invalida a anterior.
- Conexões do contrato antigo precisam de nova autorização; seus horários
  sem identificação da consulta não são exibidos como uma leitura válida.
- Leitura manual usa o limite de tentativas de conexão existente. Erros parciais
  do Google invalidam a consulta inteira; não significam agenda livre.
- Após duas horas a tela exige nova consulta. Mesmo antes disso, novos eventos
  podem ter surgido no Google: disponibilidade transacional fica para remarcação.
- Apenas a agenda principal está coberta. Agendas compartilhadas ou secundárias
  não entram nesta leitura e não devem ser consideradas livres por omissão.
- `calendarBusyCallback` responde 410 até existir um contrato correlacionado
  com uma tarefa de automação. Não ligar fluxos antigos de n8n a essa rota.
- Para escrita de eventos, solicitar novo consentimento com `calendar.app.created`
  e implementar a agenda secundária Atendara, respeitando o grau de exposição.

Referências: [OAuth Web Server](https://developers.google.com/identity/protocols/oauth2/web-server)
e [consulta freeBusy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query).
