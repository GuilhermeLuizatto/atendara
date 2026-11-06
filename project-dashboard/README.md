# Radar do projeto Atendara

**Revisão editorial:** 10/10/2026. Este radar público acompanha entregas,
trabalho em andamento, pendências, bugs e testes. Cada frente em
[status.json](status.json) tem situação, responsável, próximo passo e evidência.
O [painel de trabalho](../PAINEL-ATENDARA.md) resume prioridades e dependências.

## Visualizar

- **No GitHub:** leia o [painel de trabalho](../PAINEL-ATENDARA.md) e o
  [estado estruturado](status.json). Ambos abrem diretamente na página.
- **Dashboard com filtros:** abra
  [atendara-dashboard.html](atendara-dashboard.html), clique em **Download raw
  file** e abra o arquivo baixado no navegador. O GitHub mostra o código do
  HTML, por isso a abertura local é necessária para usar os filtros.

O HTML inclui a última cópia gerada de `status.json`. Quando há internet, tenta
ler a versão da `main` ao abrir e a cada cinco minutos enquanto a página está
visível. Também tenta mostrar PRs mesclados recentes. Se alguma consulta falhar,
o painel indica a cópia usada; não trate a leitura externa como confirmação de
publicação ou validação real.

## Manter atualizado

1. Confira código, testes, PRs e registros de validação antes de mudar uma
   situação. Use **a verificar** quando a fonte for histórica ou insuficiente.
2. Atualize `status.json` e `../PAINEL-ATENDARA.md` no mesmo PR, com data,
   responsável, evidência e próximo passo.
3. Rode `node scripts/build-project-dashboard.mjs` e depois
   `node scripts/build-project-dashboard.mjs --check`; inclua o HTML gerado.
4. Ao fechar o dia, registre entregas verificadas, bloqueios e a primeira ação
   seguinte. Merge, publicação e validação real permanecem estados distintos.

Não inclua segredos, dados de clientes nem informações privadas: este
repositório e o radar são públicos.
