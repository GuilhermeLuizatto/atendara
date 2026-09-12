<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Nexo — convencoes do projeto

SaaS multiprofissional de gestao e automacao. Leia
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) antes de mudancas estruturais.

## Regras que nao se quebram

1. **O nucleo nao conhece profissao.** Diferenca entre profissoes vem de
   `src/config/professions/definitions.ts`. Se voce precisar de um
   `if (profissao === X)` fora de `src/config/professions/`, o dado que falta
   deve virar um campo daquela tabela.
2. **O dominio nao importa `firebase/*`.** `src/types`, `src/config` e
   `src/lib/rules` ficam livres de SDK. Conversao `Timestamp` ↔ ISO so em
   `src/lib/firebase/converters.ts`.
3. **Caminho do Firestore so sai de `src/lib/firebase/paths.ts`.** Nunca monte
   string de path a mao — e assim que vazamento entre tenants acontece.
4. **Somente `ADMINISTRATIVE` recebe resposta automatica.** A trava vive em
   `CLASSIFICATION_META[...].autoResponseEligible` e e coberta por testes. Nao
   contorne.
5. **Regra `immutable` nao muda.** Nem pela interface, nem pelas Security Rules,
   nem para OWNER.
6. **`aiDecisions` e `auditLogs` sao append-only.** Nenhum papel altera ou
   apaga pelo cliente, e nenhum pedido de titular apaga a trilha. A unica
   alteracao admitida e a pseudonimizacao pelo backend (`functions/privacy.js`),
   a pedido do titular dos dados ou na exclusao da organizacao: troca so os
   campos listados em `src/config/privacy.ts`, nunca os de
   `APPEND_ONLY_PROTECTED_FIELDS`, e marca `privacyRedaction` com o id do
   pedido registrado em `privacyRequests` ou `platformAuditLogs`.
7. **Dinheiro em centavos inteiros.** Nenhum float na camada financeira.
8. **Alterou `src/config/permissions.ts`? Altere `firestore.rules` junto.** Nao
   ha como compartilhar codigo entre TypeScript e CEL.
9. **Cobranca da plataforma nao e financeiro de tenant.** Mensalidade do
   Nexo vive em `platform*` na raiz; receita e despesa do assinante vivem em
   `organizations/{orgId}/transactions`. Nenhuma consulta, agregado ou tela
   mistura as duas.
10. **Assinatura e validade so mudam pelo webhook ou por concessao registrada.**
    `subscriptionStatus` e `accessUntil` sao escritos exclusivamente pelo
    backend: pelo webhook, depois de conferir a assinatura criptografica do
    evento, ou pela concessao manual da operadora — com segundo fator, motivo,
    prazo maximo e registro append-only na mesma transacao. Nenhuma outra
    callable escreve esses campos. Retornar do checkout nao prova pagamento, e
    nenhuma callable de cobranca aceita `organizationId` do cliente.
11. **Aviso ao cliente e sempre opt-in explicito.** Nenhuma acao da agenda envia
    mensagem sozinha — confirmar um atendimento, inclusive. Sao necessarias, em
    conjunto: a chave da organizacao ligada, uma regra habilitada para aquele
    evento e canal, remetente comprovado, o canal permitido pela profissao,
    contato valido e consentimento que nomeie o canal. Todas as condicoes vivem
    em `src/lib/notifications/eligibility.ts` e sao cobertas por testes.
12. **Aviso da plataforma nao usa canal de clinica.** Situacao da assinatura e
    derivada de `platformSubscriptions` e fica dentro do painel; aviso de
    atendimento sai da organizacao. Sao remetentes, audiencias e bases legais
    diferentes, e nao existe caminho de um para o outro.

## Estilo

- Cores apenas por token semantico (`bg-surface`, `text-muted-foreground`,
  `bg-danger-soft`). Nunca `bg-zinc-100` ou `text-red-600`.
- Texto sobre `bg-accent` ou `bg-danger` usa `text-accent-foreground` ou
  `text-danger-foreground`; borda de campo e `border-input`. O contraste AA dos
  tokens e conferido por `src/lib/utils/contrast.test.ts`.
- Link com cara de botao usa `buttonStyles()`, nunca `<Button>` dentro de
  `<Link>`. Dialogo usa `Modal`/`Drawer`, que prendem e devolvem o foco.
- Codigo e enums em ingles; interface e comentarios em pt-BR.
- Comentario explica **por que**, nunca **o que**.
- Arquivos pequenos e coesos. `config/` guarda politica, `lib/` guarda mecanismo.
- Estado do cliente vindo de `localStorage` usa `useSyncExternalStore`
  (`src/lib/storage/preference-store.ts`), nunca `useEffect` + `setState` — o
  lint do React Compiler recusa e a hidratacao quebra.

## Antes de abrir PR

```bash
npm run verify   # lint + type-check + testes + build
```
