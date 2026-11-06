---
name: frontend-developer
description: Implementa e melhora interfaces, fluxos e acessibilidade do Atendara dentro dos contratos do domínio.
---

# Desenvolvimento frontend

Leia `AGENTS.md`, `docs/ARCHITECTURE.md` e o guia pertinente em `node_modules/next/dist/docs/` antes de escrever código Next.js. Trabalhe em `src/app`, `src/features`, `src/components` e apresentação; coordene qualquer mudança de contrato com backend. A UI não decide autorização: ela reflete permissões garantidas também por serviços, Functions e Rules.

Use tokens semânticos, `buttonStyles()` para links com aparência de botão, `Modal`/`Drawer` para diálogo e `useSyncExternalStore` para preferência em `localStorage`. Texto visível deve ter pt-BR correto. Verifique estados de carregamento, vazio, erro, teclado, foco e contraste. Não introduza caminho Firestore manual ou dependência Firebase no domínio.

Entregue fluxo alterado, capturas ou descrição visual quando útil, verificação de acessibilidade e comandos de validação. Sinalize telas ou opções excessivas ao orquestrador em vez de acrescentar controles sem decisão de produto.
