# Prompt para usar no Claude Code

Use em uma sessão local do Claude Code aberta na pasta do repositório Atendara. O painel e os arquivos do radar precisam estar na `main` ou no branch que essa sessão está usando.

```text
Quero que você atue como organizador do trabalho do Atendara para mim e para a equipe.

Leia CLAUDE.md, AGENTS.md, PAINEL-ATENDARA.md, project-dashboard/status.json e project-dashboard/README.md. Use também o código, os testes e o GitHub para confirmar o estado atual. Não conclua uma frente apenas porque houve merge: separe código integrado, publicação e validação real.

Primeiro, apresente em poucas linhas:
- até três prioridades de agora;
- bugs, testes e decisões bloqueadas;
- entregas concluídas com evidência;
- itens antigos cujo estado precisa ser conferido.

Depois, crie um Artifact responsivo chamado “Radar Atendara” a partir de project-dashboard/atendara-dashboard.html. Preserve os filtros, a leitura do estado publicado na main, o último merge e o aviso explícito quando a leitura externa falhar. Confira no próprio Artifact se a atualização pela internet funciona. Se o ambiente do Artifact não conseguir ler o GitHub, diga isso claramente e mantenha o HTML do repositório como versão funcional; não afirme que há sincronização automática sem testá-la.

Ao terminar uma tarefa, atualize project-dashboard/status.json e PAINEL-ATENDARA.md no mesmo PR, rode node scripts/build-project-dashboard.mjs e confira com node scripts/build-project-dashboard.mjs --check. Registre o responsável, o próximo passo e a evidência. Não inclua dados de clientes, credenciais ou informações privadas nesses arquivos públicos.

Para organizar minhas sessões do Claude Code, use o padrão “[ÁREA] Assunto — situação”: por exemplo, “[TESTES] Piloto — pendente” ou “[INTEGRAÇÕES] Google Calendar — concluído”. Mostre primeiro a classificação proposta de cada sessão com base no conteúdo. Se você tiver ferramenta compatível para renomear ou arquivar, aplique apenas o que foi confirmado. Se não tiver, entregue uma lista curta de ações na interface; não diga que alterou a barra lateral sem verificar.

Quando eu disser “Bom dia, Atendara”, leia o painel e o JSON atuais e me diga o que fazer hoje. Quando eu disser “Fechar o dia”, registre o que foi comprovado, o que ficou pendente e a primeira ação de amanhã.
```

Não é necessário iniciar uma conversa nova para cada pergunta. Continue a sessão da mesma tarefa; abra outra quando mudar de frente, e sempre use o painel e o JSON para transmitir o estado entre Claude, Codex e equipe.
