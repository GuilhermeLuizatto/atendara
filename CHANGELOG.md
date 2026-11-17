# Mudanças do Atendara

Este registro resume mudanças relevantes integradas à `main`. Código integrado, publicação e validação real são estados diferentes.

## 17/11/2026

- [PR #128](https://github.com/GuilhermeLuizatto/atendara/pull/128): a trilha do tenant passou a ser selada pelo backend. Cada entrada criada em `auditLogs` dispara `sealAuditLog`, que grava em `auditSeals` — coleção fechada ao navegador, leitura e escrita negadas a todo papel, inclusive OWNER e operadora — um registro com índice sequencial por organização, o horário de escrita do servidor, o resumo da entrada e o resumo do selo anterior. Índice e elo nascem numa transação sobre `auditSealChains/organization`, e o selo é idempotente pelo id da entrada. Com isso, remoção, reordenação e alteração dos campos protegidos ficam **detectáveis** (`verifyAuditSealChain`). **Entrada inventada em nome próprio continua possível** — risco aceito por escrito pelo titular em 17/11, com a migração das operações do navegador para callables deixada para depois do piloto. O resumo cobre só `APPEND_ONLY_PROTECTED_FIELDS.auditLogs`, para a pseudonimização a pedido de titular não quebrar a corrente. Só vale em produção depois da publicação das Functions, que o titular faz à mão, antes do site.
- [PR #121](https://github.com/GuilhermeLuizatto/atendara/pull/121): o Deploy da `main` passou a publicar as regras do Storage junto das do Firestore (`--only firestore:rules,firestore:indexes,storage`), antes do Hosting; até aqui `storage.rules` dependia de publicação à mão. **A publicação só funcionou depois de duas correções:** conceder `roles/firebasestorage.viewer` à conta de serviço do CI (`atendara-deploy`), e nomear o bucket no `firebase.json` — com `storage` fora de uma lista, o `firebase-tools` consulta o "bucket padrão" por uma API que este projeto não responde, e o erro enganoso é "Firebase Storage has not been set up". O bucket `atendo-a3481.firebasestorage.app` existe desde 25/09 em `southamerica-east1`, com as regras do repositório publicadas. Guarda de credenciais e ordem dos passos não mudaram.
- [PR #125](https://github.com/GuilhermeLuizatto/atendara/pull/125): o `firebase.json` passou a nomear o bucket do Storage (`"storage": [{ "bucket": ..., "rules": ... }]`), o que faz o `firebase-tools` publicar direto nele em vez de resolver um "bucket padrão" por API. É também mais honesto: as regras vão para um bucket escrito no repositório. Os arquivos de emulador têm config própria e seguem sem bucket.
- [PR #122](https://github.com/GuilhermeLuizatto/atendara/pull/122): o cadastro aberto passou a registrar o aceite do contrato pela organização em `platformContractAcceptances/{orgId}`, no mesmo lote que cria conta, organização e perfil, com a versão do contrato, a versão dos Termos, o id de quem aceitou e a origem — sem nome, e-mail, IP ou documento. Cada aceite deixa entrada append-only `CONTRACT_ACCEPTED` em `platformAuditLogs`. As Security Rules permitem leitura ao titular e à operadora e **negam escrita a todos**. Só vale em produção depois da publicação das Functions: `registerSelfService` mudou.
- [PR #123](https://github.com/GuilhermeLuizatto/atendara/pull/123): a criação de `aiDecisions` pelo cliente passou a ser negada nas Security Rules — quem classifica e grava a decisão é `functions/inbound.js`, com o SDK administrativo, e nenhuma tela criava decisão. Encerra metade do risco residual da revisão de segurança; `auditLogs` continua gravado pelo navegador, com o caminho de migração escrito em plano próprio. `update` e `delete` seguem negados para todos.

## 16/11/2026

- [PR #118](https://github.com/GuilhermeLuizatto/atendara/pull/118): o produto passa a ser só Psicologia, para quem atende sozinho. As outras profissões, Mensagens (com o selo), Primeiro contato, Equipe e as abas Recibos e Fila de automações ficam escondidas, sem apagar código nem dado; a lista está em `src/config/scope.ts` e no campo `listed` de `definitions.ts`. As Functions rejeitam cadastro e troca para profissão não listada, então só valem depois de publicadas. Rotas escondidas voltam ao dashboard.
- [PR #117](https://github.com/GuilhermeLuizatto/atendara/pull/117): revisão de segurança de arquivos e trilhas, com revogação dos links de download antigos (`functions/revoke-download-tokens.js`) e teto por token nas callables públicas. Regras e site foram publicados pelo Deploy; a publicação das Functions e a revogação em produção ainda dependem do titular (a simulação de 16/11 não achou objetos a revogar).

## 13/11/2026

- [PR #113](https://github.com/GuilhermeLuizatto/atendara/pull/113): o CI ganhou o job `emulator`, que roda as suítes de regras, storage, repositório e a matriz de acesso nos emuladores (Java 21, `firebase-tools` 15.29.0, projeto `demo-atendara`, sem segredos) em todo push e PR. A falha aparece no PR, mas o job ainda não é verificação obrigatória do ruleset da `main`.
- [PR #112](https://github.com/GuilhermeLuizatto/atendara/pull/112): a matriz de acesso no emulador voltou a passar inteira (201/201). O teste da cobrança usava datas fixas de ciclo que venceram em 14/10; agora elas acompanham o relógio. Regras e comportamento não mudaram. O CI ainda não roda as suítes do emulador.

## 06/11/2026

- [PR #106](https://github.com/GuilhermeLuizatto/atendara/pull/106): o CI voltou a aprovar PRs. A correção cobre o teste de cobrança que vencia com a data e os alertas de segurança no next (crítico, 16.3.8 → 16.4.5), zod, re2js e body-parser. O site subiu com o next corrigido; o zod e o body-parser das Functions só valem depois da publicação delas.
- [PR #105](https://github.com/GuilhermeLuizatto/atendara/pull/105): Termos alinhados ao ADR 0006 e página `/contrato`, com a licença de uso e o anexo de operador LGPD (`LEGAL_VERSION` e `CONTRACT_VERSION` `2026-11-06-preliminar`). O Gemini e o Amazon SES passaram a constar como suboperadores. O texto é preliminar, sem revisão jurídica, e o aceite do contrato pela organização ainda não é registrado.

## 10/10/2026

- [PR #89](https://github.com/GuilhermeLuizatto/atendara/pull/89): código de leads, encaminhamento e tomada humana da Dara integrado. A validação real do fluxo ainda precisa ser registrada.
- [PR #90](https://github.com/GuilhermeLuizatto/atendara/pull/90): análise de qualidade e cobertura no SonarQube Cloud adicionada ao CI.

## Como manter

Ao integrar um PR que muda comportamento, segurança, dados ou operação, acrescente uma linha curta com data, efeito para a equipe ou usuário, link do PR e limite de validação se houver. Não copie o histórico inteiro de commits nem marque uma funcionalidade como validada apenas pelo merge.
