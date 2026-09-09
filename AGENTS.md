<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Atendara — convencoes do projeto

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
6. **`aiDecisions` e `auditLogs` sao append-only.**
7. **Dinheiro em centavos inteiros.** Nenhum float na camada financeira.
8. **Alterou `src/config/permissions.ts`? Altere `firestore.rules` junto.** Nao
   ha como compartilhar codigo entre TypeScript e CEL.

## Estilo

- Cores apenas por token semantico (`bg-surface`, `text-muted-foreground`,
  `bg-danger-soft`). Nunca `bg-zinc-100` ou `text-red-600`.
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
