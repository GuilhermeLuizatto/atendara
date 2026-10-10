# Painel de trabalho do Atendara

**Atualizado em:** 10/10/2026. Este é o resumo compartilhado para a equipe e para novos chats de desenvolvimento. O estado abaixo é uma fotografia inicial; confirme código, testes, PRs e produção antes de mudar um item para **concluído**.

## Como usar

- Abra uma tarefa no projeto Atendara e diga **“Bom dia, Atendara”** para receber até três prioridades, bloqueios e uma primeira ação. As instruções de `AGENTS.md` fazem o agente ler este painel.
- Diga **“Fechar o dia”** para registrar entregas verificadas, pendências e próximo passo. Toda tarefa concluída deve atualizar sua linha aqui, com evidência.
- Abra um novo chat para uma frente delimitada. O chat guarda a discussão; este painel guarda o estado que a equipe precisa encontrar depois.
- Registre decisão de produto como decisão do titular, com data. Ideias e propostas não viram compromisso de implementação automaticamente.
- Antes de publicar ou marcar validação real como concluída, confira o ambiente e a evidência. Teste local, merge e publicação são estados distintos.

## Próximas frentes

| Frente                                       | Estado em 10/10                                           | Responsável | Próximo passo e evidência esperada                                                                                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revisão de segurança de arquivos e trilhas   | Correções locais em andamento; revisão ainda aberta       | A definir   | Integrar e testar as correções de acesso. Avaliar migração da criação de `auditLogs` e `aiDecisions` para operações de backend e tratar links antigos antes de declarar o bloco fechado. Registrar PR, testes e decisão de publicação.        |
| Validações reais do piloto                   | Pendentes                                                 | A definir   | Escolher um fluxo do roteiro em `docs/VALIDACOES-REAIS-PENDENTES.md`, executar com dados fictícios e registrar evidência real. Não confundir testes automatizados com validação de produção.                                                  |
| Cobrador automático do cliente               | Proposta; lembrete automático ainda não implementado      | A definir   | Decidir escopo mínimo e consentimento específico de cobrança. Implementar somente após critérios de aceite e revisão das travas de envio. O desenho inicial está em `COBRADOR-DARA-RECEITA-SAUDE.md` enquanto esse arquivo não for integrado. |
| Guia e papéis dos agentes de desenvolvimento | Preparados localmente; compartilhamento pelo Git pendente | A definir   | Revisar e integrar `docs/AGENTES-DESENVOLVIMENTO.md` e `.claude/agents/` para disponibilizar à equipe.                                                                                                                                        |

## Dependências externas

| Tema                     | Situação                                                                         | Próxima decisão ou evidência                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| WhatsApp real            | Depende da habilitação da Meta e de validação controlada                         | Registrar confirmação da conta, remetente, modelo e teste autorizado antes de ativar envios.                        |
| Receita Saúde pela Dara  | Não há integração oficial confirmada para emissão por terceiros no desenho atual | Confirmar documentação, credenciamento e homologação oficiais antes de prometer emissão automática.                 |
| Piloto com profissionais | Depende de validações reais e decisões do titular                                | Usar o roteiro de validações; documentar participantes, consentimentos e resultado sem dados pessoais neste painel. |

## Concluído recentemente

- **10/10:** papéis de desenvolvimento e guia de orquestração preparados no checkout local. Ainda não são uma entrega compartilhada até serem integrados ao repositório.
- **10/10:** desenho inicial do cobrador e da Dara fiscal preparado; o lembrete automático e a emissão fiscal não foram implementados.

## Registro de passagem

Ao atualizar uma frente, mantenha: **estado**, **responsável**, **próximo passo** e **evidência** (arquivo, teste, PR ou registro de validação). Se o trabalho estiver em outro chat ou em alterações locais, deixe isso explícito. Evite colar a conversa inteira ou duplicar o roteiro detalhado: este painel deve continuar rápido de ler.
