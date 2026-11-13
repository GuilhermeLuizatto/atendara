# Painel de trabalho do Atendara

**Atualizado em:** 13/11/2026 (suítes do emulador entrando no CI). Este é o resumo compartilhado para a equipe e para novos chats de desenvolvimento. O estado abaixo é uma fotografia inicial; confirme código, testes, PRs e produção antes de mudar um item para **concluído**.

**Visão rápida:** [Radar do projeto](project-dashboard/README.md) e [dashboard HTML](project-dashboard/atendara-dashboard.html). O HTML inclui uma cópia do estado e tenta consultar `project-dashboard/status.json` na `main`; se não conseguir, indica que mostra a cópia incluída. O JSON e este painel devem ser atualizados no mesmo PR sempre que a situação de uma frente mudar.

## Como usar

- Abra uma tarefa no projeto Atendara e diga **“Bom dia, Atendara”** para receber até três prioridades, bloqueios e uma primeira ação. As instruções de `AGENTS.md` fazem o agente ler este painel.
- Diga **“Fechar o dia”** para registrar entregas verificadas, pendências e próximo passo. Toda tarefa concluída deve atualizar sua linha aqui, com evidência.
- Abra um novo chat para uma frente delimitada. O chat guarda a discussão; este painel guarda o estado que a equipe precisa encontrar depois.
- Registre decisão de produto como decisão do titular, com data. Ideias e propostas não viram compromisso de implementação automaticamente.
- Antes de publicar ou marcar validação real como concluída, confira o ambiente e a evidência. Teste local, merge e publicação são estados distintos.

## Próximas frentes

| Frente                                       | Estado em 10/10                                       | Responsável | Próximo passo e evidência esperada                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revisão de segurança de arquivos e trilhas   | Correções locais em andamento; revisão ainda aberta   | A definir   | **Em 06/11:** 16 arquivos alterados só na cópia local do titular, sem branch nem PR. Isso bloqueia a E3 dos termos, que mexe em `firestore.rules`, `functions/index.js` e `scripts/test-firestore-rules.mjs`. Integrar e testar as correções de acesso. Avaliar migração da criação de `auditLogs` e `aiDecisions` para operações de backend e tratar links antigos antes de declarar o bloco fechado. Registrar PR, testes e decisão de publicação. |
| Suítes do emulador no CI                     | Em revisão desde 13/11                                | Titular     | **Em 13/11:** job `emulator` em `.github/workflows/ci.yml`, no [PR #113](https://github.com/GuilhermeLuizatto/atendara/pull/113), roda `npm run test:emulator` (regras, storage, repositório e matriz de acesso) com Java 21 e `firebase-tools` 15.29.0. O job passou no próprio PR, em cerca de 4 minutos: 556 regras, 20 de storage, 49 de repositório e 201 de acesso. O PR #112, que conserta a matriz de acesso, já está na `main` e foi trazido para a branch. Depois de algumas execuções verdes na `main`, incluir o job nas verificações obrigatórias do ruleset `main protegida`. |
| Validações reais do piloto                   | Pendentes                                             | A definir   | Escolher um fluxo controlado, executar com dados fictícios e registrar evidência real. Não confundir testes automatizados com validação de produção.                                                                                   |
| Dara: leads e escalonamento humano           | Código integrado à `main`; validação real a confirmar | A definir   | Conferir recebimento, consentimento, encaminhamento e tomada humana em teste controlado. O merge do PR #89 não substitui essa validação.                                                                                               |
| Cobrador automático do cliente               | Proposta; lembrete automático ainda não implementado  | A definir   | Decidir escopo mínimo e consentimento específico de cobrança. Implementar somente após critérios de aceite e revisão das travas de envio.                                                                                              |
| Guia e papéis dos agentes de desenvolvimento | Integrados à `main` pelo PR #92                       | Equipe      | Usar `docs/AGENTES-DESENVOLVIMENTO.md` e `.claude/agents/` nas próximas frentes; revisar a rotina conforme o uso.                                                                                                                      |
| Termos, contrato de licença e anexo LGPD     | E1 e E2 no ar desde 06/11; E3 a E5 aguardam           | Titular     | **No ar:** PR #105 mergeado (`605855f`), Deploy aprovado, e `atendara.app/termos` e `/contrato` servem a versão `2026-11-06-preliminar` (lido na página). Functions publicadas pelo titular antes do merge, segundo ele, sem conferência por `functions:list`. O suboperador Gemini e o Amazon SES (`us-east-2`) entraram no anexo e na Política. **Próximo:** E3, registro do aceite em `platformContractAcceptances`, só depois de a revisão de segurança ter branch e PR próprios, porque mexe nos mesmos arquivos. Conferir a região do Cloud Storage. Texto sem revisão jurídica. |
| Operação inicial sem CNPJ                    | Proposta do titular em 06/11                          | Titular     | Validar com contador a forma de recebimento e os gatilhos de abertura do CNPJ. Ver `docs/decisions/0006-operacao-inicial-sem-cnpj.md`.                                                                                                |
| Marca no INPI                                | Não iniciado                                          | Titular     | Busca de anterioridade de "Atendara" e depósito (classe 42; avaliar 35 e 9). Registrar número do processo.                                                                                                                             |
| NFS-e Nacional pelo cliente                  | Proposta; nada implementado                           | A definir   | Escolher o provedor de emissão e definir o escopo do MVP. Ver `docs/planos/NFSE-NACIONAL-2026-11-06.md`.                                                                                                                               |

## Dependências externas

| Tema                     | Situação                                                                         | Próxima decisão ou evidência                                                                         |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| WhatsApp real            | Depende da habilitação da Meta e de validação controlada                         | Registrar confirmação da conta, remetente, modelo e teste autorizado antes de ativar envios.         |
| Receita Saúde pela Dara  | Não há integração oficial confirmada para emissão por terceiros no desenho atual | Confirmar documentação, credenciamento e homologação oficiais antes de prometer emissão automática.  |
| Piloto com profissionais | Depende de validações reais e decisões do titular                                | Executar fluxos controlados; documentar consentimentos e resultados sem dados pessoais neste painel. |

## Concluído recentemente

- **06/11:** [PR #106](https://github.com/GuilhermeLuizatto/atendara/pull/106) destravou o CI de todos os PRs. Corrigiu o teste de cobrança vencido pela data e os alertas no next (crítico, 16.3.8 → 16.4.5), zod, re2js e body-parser. Depois entraram #105 (termos e contrato), #108 e #104 (Dependabot). As Functions com o zod e o body-parser novos dependem da publicação pelo titular.

- **10/10:** papéis de desenvolvimento, guia de orquestração e este painel integrados à `main` pelo [PR #92](https://github.com/GuilhermeLuizatto/atendara/pull/92).
- **10/10:** Google Calendar corrigido no radar para concluído. A rodada de validações de 28/09 registrou o roteiro das três frentes e o isolamento com contas de teste; falta só repetir com um segundo membro da mesma organização, junto da validação de equipe.
- **10/10:** desenho inicial do cobrador e da Dara fiscal preparado; o lembrete automático e a emissão fiscal não foram implementados.

## Fechamento de 06/11

- **Entregue e verificado:** PRs #106, #105, #108 e #104 mergeados, com CI e Deploy da `main` aprovados (último: `601f326`). Termos e `/contrato` no ar na versão `2026-11-06-preliminar`, conferida na página.
- **Em andamento:** revisão de segurança, só na cópia local, sem branch; este painel no PR #109, com CI aprovado e aguardando merge.
- **Bloqueios:** a E3 dos termos espera a revisão de segurança ganhar branch e PR. O texto jurídico espera advogado. A região do Cloud Storage precisa ser conferida no console.
- **Responsável:** titular para merge, publicação, contador e advogado. A revisão de segurança ainda está sem responsável.
- **Próximo passo:** mergear o #109; criar branch e PR da revisão de segurança; depois disso, E3 (registro do aceite em `platformContractAcceptances`).
- **A conferir:** publicação das Functions de 06/11 por `functions:list` e um autocadastro de teste em produção com a versão nova dos Termos.

## Registro de passagem

Ao atualizar uma frente, mantenha: **estado**, **responsável**, **próximo passo** e **evidência** (arquivo, teste, PR ou registro de validação). Se o trabalho estiver em outro chat ou em alterações locais, deixe isso explícito. Evite colar a conversa inteira ou duplicar o roteiro detalhado: este painel deve continuar rápido de ler.
