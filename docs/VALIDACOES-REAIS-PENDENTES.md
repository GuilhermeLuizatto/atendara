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
| 5 | Código concluído na branch; roteiro real pendente depois da integração e publicação |

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

## Fase 5 — produto operacional

**Situação geral:** PRONTA NO CÓDIGO DA BRANCH. Equipe, importação, chamados, anexos, identidade visual e a política de três tentativas foram implementados e cobertos pelos testes que não dependem do titular. O roteiro abaixo passa a ser executável depois do merge e da publicação das Functions, regras, índices, Storage e interface. O catálogo e os preços dos planos continuam deliberadamente em espera; cobrança real permanece bloqueada.

Usar somente contas e dados fictícios. Não anexar dado de cliente, segredo, senha ou código de segundo fator às evidências.

### 5.1 — Convites e equipe

**Situação:** PENDENTE, depende de contas de e-mail reais controladas pelo titular.

1. Convidar, um de cada vez, ADMIN, PROFESSIONAL, ASSISTANT e VIEWER e confirmar que o Amazon SES entrega o e-mail automaticamente.
2. Abrir o link, confirmar que ele identifica o e-mail convidado e criar a própria senha; para PROFESSIONAL, preencher profissão, registro e especialidades.
3. Reenviar um convite e confirmar que somente o link mais recente funciona; repetir depois de sete dias com um convite próprio para confirmar a expiração.
4. Confirmar que OWNER não pode ser transferido, convidado, suspenso nem removido; ADMIN não pode criar ou gerir outro ADMIN.
5. Como PROFESSIONAL, solicitar a inclusão de um funcionário; confirmar que o e-mail só sai depois da aprovação por titular, OWNER ou ADMIN.
6. Ligar ASSISTANT, VIEWER e PROFESSIONAL a mais de um profissional e confirmar os vínculos; confirmar que ADMIN permanece organizacional.
7. Suspender e reativar uma conta, incluindo uma sessão que já estava aberta.
8. Remover uma conta e confirmar que o acesso não volta, enquanto o histórico necessário permanece pseudonimizado.
9. Tentar reutilizar um e-mail que já possui conta e confirmar que ele não entra em outra organização.

**Evidência esperada:** capturas do convite, primeiro acesso, lista da equipe e negações, com e-mails mascarados.

### 5.2 — Importação administrativa

**Situação:** PENDENTE, depende de arquivos reais de teste preparados pelo titular.

Preparar CSV e XLSX fictícios para profissionais, clientes, atendimentos e financeiro. Em cada tipo:

- testar o modelo oficial e um arquivo vindo de outro sistema, mapeando as colunas;
- salvar um modelo de mapeamento, recarregar e reutilizá-lo;
- revisar a prévia e desfazer antes de confirmar, comprovando que nada foi gravado;
- incluir linhas inválidas e referências ausentes, confirmando o bloqueio;
- incluir duas linhas duplicadas no mesmo arquivo e duplicidades já existentes;
- decidir linha por linha entre ignorar e atualizar o existente; nunca deve nascer uma terceira cópia;
- tentar incluir uma coluna clínica e confirmar que o arquivo é recusado;
- confirmar uma importação válida e conferir integridade, valores em centavos, datas, vínculos e isolamento da organização.

A chave de duplicidade deve ser conferida como definida: profissional por e-mail; cliente por e-mail ou telefone; atendimento por cliente, profissional, início e fim; financeiro por tipo, data, valor, cliente e descrição.

**Evidência esperada:** arquivos fictícios usados, quantidade de linhas, decisões por duplicidade e capturas antes/depois, sem dados reais.

### 5.3 — Chamados no painel

**Situação:** PENDENTE, depende da operação real do titular e do Amazon SES.

1. Abrir chamados fictícios em cada categoria e nível de queixa disponível.
2. Confirmar que o autor vê os próprios chamados, OWNER/ADMIN veem toda a organização e outro membro comum não vê o chamado alheio.
3. Na área de suporte da plataforma, definir prioridade e situação; confirmar que a prioridade é decisão do suporte e que a fila segue a data de abertura.
4. Trocar mensagens nos dois lados, anexando uma imagem e um PDF permitidos; tentar tipo proibido e confirmar a recusa.
5. Confirmar que as notificações chegam por e-mail pelo remetente `guilhermeluizatto@gmail.com`, mas que responder ao e-mail não entra na conversa oficial.
6. Confirmar que toda resposta oficial fica no painel e que a primeira resposta respeita a promessa publicada de até 2 dias úteis.
7. Sem conta, confirmar que existe somente o canal público legal, de privacidade e recuperação; suporte operacional deve exigir login.

**Evidência esperada:** ids não secretos dos chamados, horários e capturas com textos fictícios.

### 5.4 — Logo da organização

**Situação:** PENDENTE, depende de uma imagem escolhida pelo titular.

- enviar PNG, JPEG e WebP quadrados de até 2 MB e confirmar o recorte; tentar SVG e arquivo acima do limite;
- confirmar que o titular pagante, OWNER e ADMIN alteram o logo e os demais papéis não;
- conferir o logo no identificador lateral e nos e-mails da organização;
- conferir o fallback com a estrela roxa depois de remover a imagem;
- quando um documento ou outra área do painel usar a identidade da organização, confirmar que consome o mesmo logo, sem nova cópia divergente.

### 5.5 — Planos, piloto e Stripe

**Situação:** PENDENTE E EM ESPERA POR DECISÃO COMERCIAL. Não ativar cobrança real ainda.

- definir e aprovar o catálogo final: nomes, preços, módulos, limites e quais recursos dependem de cada plano;
- decidir como os participantes atuais do piloto serão migrados;
- validar o teste de 14 dias e a disponibilidade de recursos conforme o plano final;
- confirmar com a Stripe e com a revisão jurídica/fiscal se cartão, Pix e boleto estarão realmente disponíveis;
- atualizar e aprovar Termos e Política antes da primeira contratação;
- somente com nova autorização explícita, realizar uma contratação real de baixo valor e conferir webhook assinado, acesso, fatura, portal e idempotência;
- testar cancelamento no fim do período, recuperação de pagamento e reembolso autorizado;
- provocar três tentativas de cobrança recusadas em ambiente controlado: a primeira e a segunda mantêm o painel; a terceira fecha o acesso;
- conferir que o painel administrativo e a Stripe mostram os mesmos estados e valores.

**Evidência esperada:** decisão escrita do catálogo e da migração; nos testes financeiros, identificadores sem segredo, valores, horários e capturas com dados pessoais mascarados. Toda movimentação real exige autorização explícita no momento do teste.

## Validações já concluídas e removidas da lista pendente

- E-mail com domínio próprio: reteste real concluído em 25/09/2026 com endereço inédito; a mensagem chegou à caixa principal e o link confirmou o endereço.
- Google Calendar, roteiro original de leitura manual: concluído em 24/09/2026. A pendência atual é repetir o roteiro ampliado depois da publicação final das três frentes.
