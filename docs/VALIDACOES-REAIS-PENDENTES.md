# Validações reais pendentes do Atendara

**Atualizado em:** 25/09/2026

**Escopo:** somente validações que dependem de ação, credencial, conta, decisão ou confirmação do titular. Testes automatizados e verificações que podem ser executadas integralmente pelo desenvolvimento não entram nesta lista.

## Como manter este documento

- Marcar um item como concluído somente com evidência real do resultado.
- Atualizar esta fonte sempre que uma entrega mudar o roteiro ou eliminar uma pendência.
- Regenerar `docs/VALIDACOES-REAIS-PENDENTES.pdf` com `python scripts/generate-validation-pdf.py`.
- Nunca registrar neste arquivo senhas, tokens, chaves, códigos OAuth ou dados pessoais de clientes.

## Resumo

| Fase | Situação das validações que dependem do titular |
| --- | --- |
| 3B | Bloqueada pela etapa externa da Meta que, na conta atual, exige CNPJ |
| 3C | Pendente repetir em produção o roteiro final das três frentes e concluir a verificação do app no Google |
| 4 | Pendente a autorização e a validação controlada antes de liberar Gemini para uma organização real |
| 5 | Ainda não executável; os fluxos precisam ser concluídos e quatro decisões do titular estão abertas |

## Fase 3B — WhatsApp e n8n

### 3B.1 — Concluir a habilitação externa na Meta

**Situação:** BLOQUEADA.

Na conta Meta atualmente usada pelo projeto, a conclusão da verificação pede um CNPJ. O titular informou que ainda não possui CNPJ; portanto, esta etapa e os testes dependentes permanecem em espera.

Quando for possível prosseguir, o titular deverá:

- concluir a verificação solicitada pela Meta;
- confirmar o número de WhatsApp Business e o remetente que serão usados pelo Atendara;
- confirmar no painel da Meta que o app, o número e os modelos necessários estão autorizados para o ambiente que será testado.

**Evidência esperada:** confirmação visual dos estados no painel da Meta, sem expor tokens ou segredos.

### 3B.2 — Validar uma saída real de WhatsApp

**Situação:** PENDENTE, depende de 3B.1 e do n8n controlado.

O titular deverá fornecer ou operar o número e um destinatário autorizado pela Meta e confirmar:

- a mensagem correta chegou ao destinatário autorizado;
- o nome do remetente, o modelo e as variáveis exibidas estão corretos;
- o consentimento para WhatsApp existe e pode ser retirado;
- aceite da tarefa pelo n8n e entrega confirmada pela Meta aparecem como estados distintos;
- repetir o mesmo evento não gera duas mensagens.

**Evidência esperada:** horário, identificador não secreto da execução e captura do recebimento, com telefone mascarado.

### 3B.3 — Validar uma entrada real de WhatsApp

**Situação:** PENDENTE, depende de 3B.1 e do n8n controlado.

Com mensagens fictícias e sem dados de saúde, o titular deverá enviar pelo WhatsApp:

1. um pedido administrativo simples;
2. uma mensagem ambígua;
3. uma mensagem que exija atendimento humano;
4. um pedido de opt-out.

Deverá ser confirmado que a mensagem entra no tenant correto, a assinatura é aceita somente no fluxo legítimo, a classificação e o escalonamento aparecem no painel e o opt-out impede novas mensagens daquele canal.

**Evidência esperada:** resultado visível no painel e no aparelho, com conteúdo fictício e identificadores pessoais mascarados.

### 3B.4 — Aprovar o ambiente operacional do n8n

**Situação:** PENDENTE.

Antes do piloto, o titular deverá confirmar que o n8n está em HTTPS controlado, com acesso administrativo protegido por segundo fator, editor fora da internet pública, segredos rotacionados, monitoramento ativo e procedimento de revogação emergencial dos tokens.

**Evidência esperada:** checklist operacional assinado pelo titular; nenhuma chave deve ser anexada.

## Fase 3C — Google Calendar

### 3C.1 — Repetir o roteiro real final das três frentes

**Situação:** PENDENTE.

O código foi integrado à `main` e as Functions da Fase 3 foram publicadas em 25/09/2026. Falta repetir o roteiro real no estado final publicado:

**Frente 1 — agenda “Atendara”**

- conectar uma conta Google autorizada;
- criar, remarcar, cancelar e trocar o profissional de atendimentos fictícios;
- confirmar que os eventos são criados, atualizados ou removidos na agenda secundária “Atendara”;
- confirmar que a descrição permanece vazia e que nenhum dado além do permitido pela profissão aparece;
- desconectar e confirmar que a agenda secundária é apagada.

**Frente 2 — ocupado automático**

- criar um compromisso fictício na agenda principal do Google;
- aguardar a rotina de até 30 minutos, sem clicar em atualização manual;
- confirmar que o painel passa a mostrar o bloco ocupado e avisa sobre conflito;
- remover o compromisso e confirmar a atualização automática posterior;
- confirmar que leitura antiga ou falha nunca é apresentada como agenda livre.

**Frente 3 — queda e reconexão**

- revogar o acesso do Atendara na Conta Google;
- confirmar que surge um único alerta de alta prioridade com caminho para Google Calendar;
- confirmar que a mensagem não termina com o sufixo técnico `[503]`;
- reconectar e confirmar que o alerta é resolvido;
- repetir a queda e desconectar pelo painel, confirmando novamente a resolução.

**Evidência esperada:** capturas da agenda Google e do painel, horários fictícios usados e confirmação escrita de cada resultado.

### 3C.2 — Validar o isolamento com pessoas reais de teste

**Situação:** PENDENTE.

Usando contas de teste separadas, confirmar que outra pessoa, outro tenant e a operadora da plataforma não conseguem conectar ou consultar o perfil Google de um profissional. Essa barreira já tem cobertura automatizada; falta a confirmação real de interface e credenciais.

### 3C.3 — Concluir a verificação do app no Google

**Situação:** PENDENTE antes do piloto aberto.

O titular deverá conduzir ou aprovar a verificação do escopo sensível `calendar.app.created` na tela OAuth do Google. Enquanto isso, o app não verificado pode mostrar aviso e fica sujeito ao limite do Google.

**Evidência esperada:** estado aprovado na configuração OAuth, sem expor credenciais.

## Fase 4 — Gemini em organização real

### 4.1 — Autorizar e acompanhar um piloto controlado

**Situação:** PENDENTE.

O Gemini está ativo somente para organizações de teste em allowlist. Antes de incluir uma organização real, o titular deverá:

- escolher explicitamente qual organização participará do piloto;
- confirmar que aceita a transferência limitada de texto ao Google na modalidade paga;
- orientar o uso apenas de mensagens fictícias na primeira validação;
- revisar no painel casos administrativos, ambíguos e de risco;
- confirmar que somente o administrativo elegível recebe automação e que dúvida, sensibilidade ou risco sempre chegam a uma pessoa;
- autorizar separadamente a permanência ou a remoção da organização na allowlist após o teste.

**Evidência esperada:** autorização registrada, organização escolhida e resultado agregado do roteiro, sem copiar mensagens reais para este documento.

## Fase 5 — validações reais previstas

**Situação geral:** AINDA NÃO EXECUTÁVEL. O suporte público e a cobrança em modo de teste já existem. Gestão de equipe pelo assinante e importação administrativa ainda não estão concluídas; a cobrança real está bloqueada deliberadamente no código e os Termos ainda descrevem piloto gratuito.

As validações abaixo só serão marcadas como prontas para execução depois que os respectivos fluxos estiverem implementados e testados automaticamente.

### 5.1 — Equipe

- convidar uma segunda conta de teste usando um e-mail real controlado pelo titular;
- aceitar o convite, entrar e concluir o primeiro acesso;
- conferir na prática cada papel que o titular decidir disponibilizar;
- suspender, reativar e remover a conta, confirmando o efeito sobre uma sessão já aberta;
- confirmar que a conta nunca alcança outro tenant nem funções acima do papel concedido.

### 5.2 — Importação administrativa

- entregar um arquivo de exemplo no formato e no escopo que ainda serão definidos pelo titular;
- conferir a prévia, erros por linha, duplicidades e totais antes de confirmar;
- validar uma importação real controlada e a forma de desfazer ou corrigir o resultado definida para o produto;
- confirmar que nenhuma linha entra em outro tenant.

### 5.3 — Suporte

- enviar uma solicitação de teste para `suporte@atendara.app`;
- confirmar recebimento, identificação segura da conta e resposta dentro da promessa publicada de até 2 dias úteis;
- confirmar que o atendimento não solicita senha, segundo fator nem dado de saúde.

### 5.4 — Planos e cobrança real da plataforma

- confirmar definitivamente nomes, módulos e preços dos planos antes de retirar a trava de teste;
- atualizar e aprovar Termos e Política aplicáveis à cobrança antes da primeira contratação;
- conferir na Stripe que os preços cadastrados são exatamente os mostrados pelo Atendara;
- realizar uma contratação real de baixo valor autorizada pelo titular;
- confirmar webhook assinado, liberação de acesso, fatura, portal do cliente e ausência de cobrança duplicada;
- testar cancelamento no fim do período, falha de pagamento e recuperação;
- realizar e conferir um reembolso autorizado;
- confirmar no painel administrativo que valores e estados correspondem à Stripe.

**Evidência esperada:** identificadores da Stripe sem segredo, valores, horários e capturas com dados pessoais mascarados. Toda movimentação financeira real exige autorização explícita do titular no momento do teste.

## Decisões abertas que impedem concluir a Fase 5

Estas perguntas não são validações concluídas nem decisões tomadas:

1. **Equipes:** quais papéis poderão ser convidados pelo assinante e como o convite deve chegar — e-mail automático ou senha inicial entregue manualmente?
2. **Importação:** qual formato de entrada será aceito, quais entidades entram na primeira versão e como duplicidades devem ser tratadas?
3. **Suporte:** o canal por e-mail já publicado é suficiente para a Fase 5 ou é necessário um sistema de chamados dentro do painel?
4. **Planos e cobrança:** os três planos, preços e módulos atuais são definitivos, e a Fase 5 deve preparar o modo real sem ativá-lo ou já autoriza a futura ativação após os testes e documentos legais?

## Validações já concluídas e removidas da lista pendente

- E-mail com domínio próprio: reteste real concluído em 25/09/2026 com endereço inédito; a mensagem chegou à caixa principal e o link confirmou o endereço.
- Google Calendar, roteiro original de leitura manual: concluído em 24/09/2026. A pendência atual é repetir o roteiro ampliado depois da publicação final das três frentes.
