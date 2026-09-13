/**
 * Fila de automacao (Fase 3, 13.2).
 *
 * `config/automation.ts` guarda a politica; este diretorio guarda o mecanismo.
 * Funcoes puras: `functions/automation.js` le e grava, e tudo o que decide o que
 * gravar esta aqui, testavel sem emulador. Nenhum arquivo importa `firebase/*`.
 */
export * from "./appointment-changes";
export * from "./dispatch";
export * from "./effects";
export * from "./tasks";
