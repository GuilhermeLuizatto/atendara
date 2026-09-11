/**
 * Nucleo de avisos.
 *
 * `config/notifications.ts` guarda a politica; este diretorio guarda o
 * mecanismo. Nenhum arquivo aqui importa `firebase/*` — todos sao funcoes puras
 * do estado para uma decisao, o que os torna testaveis sem emulador e permite
 * que a mesma regra rode no navegador e, no futuro, no backend.
 *
 * Nada aqui envia mensagem real: o unico provedor implementado e o simulado.
 */
export * from "./consent-text";
export * from "./contacts";
export * from "./delivery";
export * from "./dispatch";
export * from "./eligibility";
export * from "./planner";
export * from "./platform-notices";
export * from "./providers";
export * from "./schedule";
export * from "./templates";
