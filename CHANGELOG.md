# Mudanças do Atendara

Este registro resume mudanças relevantes integradas à `main`. Código integrado, publicação e validação real são estados diferentes.

## 06/11/2026

- [PR #106](https://github.com/GuilhermeLuizatto/atendara/pull/106): o CI voltou a aprovar PRs. A correção cobre o teste de cobrança que vencia com a data e os alertas de segurança no next (crítico, 16.3.8 → 16.4.5), zod, re2js e body-parser. O site subiu com o next corrigido; o zod e o body-parser das Functions só valem depois da publicação delas.
- [PR #105](https://github.com/GuilhermeLuizatto/atendara/pull/105): Termos alinhados ao ADR 0006 e página `/contrato`, com a licença de uso e o anexo de operador LGPD (`LEGAL_VERSION` e `CONTRACT_VERSION` `2026-11-06-preliminar`). O Gemini e o Amazon SES passaram a constar como suboperadores. O texto é preliminar, sem revisão jurídica, e o aceite do contrato pela organização ainda não é registrado.

## 10/10/2026

- [PR #89](https://github.com/GuilhermeLuizatto/atendara/pull/89): código de leads, encaminhamento e tomada humana da Dara integrado. A validação real do fluxo ainda precisa ser registrada.
- [PR #90](https://github.com/GuilhermeLuizatto/atendara/pull/90): análise de qualidade e cobertura no SonarQube Cloud adicionada ao CI.

## Como manter

Ao integrar um PR que muda comportamento, segurança, dados ou operação, acrescente uma linha curta com data, efeito para a equipe ou usuário, link do PR e limite de validação se houver. Não copie o histórico inteiro de commits nem marque uma funcionalidade como validada apenas pelo merge.
