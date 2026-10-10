# Radar do projeto Atendara

O arquivo `atendara-dashboard.html` é um painel responsivo que pode ser aberto no navegador ou usado como fonte de um Artifact no Claude. Ele mostra a cópia inicial incluída no HTML e, quando consegue acessar a rede, carrega `status.json` da `main` a cada abertura e a cada cinco minutos enquanto a página está visível. Também mostra o último PR mesclado na `main` pela API pública do GitHub.

A seção “Últimas mudanças na main” lista os cinco PRs mesclados mais recentes. O [CHANGELOG.md](../CHANGELOG.md) é o resumo editorial das mudanças relevantes para a equipe; a lista automática não substitui essa explicação.

`status.json` contém apenas acompanhamento público do projeto. Não inclua dados de clientes, segredos, links internos ou decisões privadas. Cada item tem situação, tipo, próximo passo e evidência. Use **a-verificar** quando uma conversa antiga indicar pendência sem prova recente; use **concluido** somente com evidência. Um merge atualiza a atividade do GitHub, mas não muda automaticamente o estado editorial de um item.

Ao mudar o estado de uma frente em um PR:

1. Atualize `status.json` e o resumo de `PAINEL-ATENDARA.md` no mesmo PR.
2. Rode `node scripts/build-project-dashboard.mjs` e inclua o HTML gerado.
3. Rode `node scripts/build-project-dashboard.mjs --check` antes de enviar.

Depois do merge, o dashboard busca o novo `status.json` sem custo de API de modelo. A consulta anônima ao GitHub depende de internet e está sujeita ao limite público da API. Se ela falhar, o painel mostra claramente a última cópia incluída no HTML.

## Claude Artifact

Este repositório não publica diretamente no espaço de Artifacts da conta Claude. Abra `atendara-dashboard.html` no Claude e peça para criar um Artifact visual a partir dele, preservando a leitura do `status.json` da `main` e o aviso quando a rede falhar. Confira o funcionamento da leitura externa no Artifact antes de tratá-lo como atualizado automaticamente. O arquivo HTML deste repositório permanece como versão recuperável e compartilhável pela equipe.
