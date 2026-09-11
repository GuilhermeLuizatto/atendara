/**
 * Barrel do dominio. Componentes e servicos devem importar de `@/types`,
 * nunca de um arquivo interno especifico, para que a reorganizacao dos modulos
 * de dominio nao vaze para a camada de apresentacao.
 */
export * from "./ai";
export * from "./appointment";
export * from "./audit";
export * from "./billing";
export * from "./classification";
export * from "./client";
export * from "./common";
export * from "./conversation";
export * from "./finance";
export * from "./notification";
export * from "./notifications";
export * from "./organization";
export * from "./pagination";
export * from "./platform";
export * from "./privacy";
export * from "./profession";
export * from "./professional";
export * from "./rules";
