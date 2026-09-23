# Google Calendar — primeira entrega da fase 3C

Implementado: cada profissional conecta a própria conta, consulta manualmente
os próximos 30 dias da agenda principal e desconecta. Entram apenas início e
fim dos intervalos ocupados. Nenhum evento ou contato é criado, alterado ou
enviado. Não há atualização automática, bloqueio na agenda do Atendara ou
remarcação nesta entrega. A integração ainda precisa de ativação e teste real.

## Configuração do ambiente de teste

1. Habilitar Google Calendar API no projeto Google Cloud e configurar a tela
   de consentimento OAuth. Em modo de teste, cadastrar a conta que autorizará.
2. Criar um cliente OAuth do tipo aplicação Web. Cadastrar como URI de retorno
   a URL HTTPS exata da function `googleOAuthCallback` em `southamerica-east1`.
3. Nas variáveis das Functions (`functions/.env.<project-id>`), preencher
   `GOOGLE_OAUTH_CLIENT_ID`, `CALENDAR_REDIRECT_URL` e `CALENDAR_KMS_KEY`
   (nome completo da CryptoKey: `projects/.../locations/.../keyRings/.../cryptoKeys/...`).
4. Guardar `GOOGLE_OAUTH_CLIENT_SECRET` e `CALENDAR_STATE_SECRET` no Secret
   Manager. O segundo deve ser aleatório e forte, separado de outros segredos.
   No emulador, usar `.secret.local`; nunca `NEXT_PUBLIC_*` ou arquivos versionados.
5. Habilitar Cloud KMS e criar uma chave simétrica. Dar à conta `fn-automacao`
   acesso de criptografia/descriptografia **somente nessa chave**, além do
   acesso aos dois segredos. O material OAuth é cifrado antes de ser persistido.
6. Gerar os módulos com `node scripts/build-functions.mjs`, executar
   `npm run verify` e `npm run test:repository`. Publicar em ambiente controlado
   `startCalendarConnection`, `googleOAuthCallback`, `getCalendarConnection`,
   `refreshCalendarBusy`, `disconnectCalendar` e `calendarBusyCallback`, além
   do painel. A última fecha o contrato legado que aceitava ocupado sem pedido.
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
