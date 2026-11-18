import { createMetaCloudApiProvider } from "./generated/notifications-providers-meta-cloud-api.js";

/**
 * A parte com segredo do provedor da Cloud API.
 *
 * O contrato e as decisoes estao em
 * `src/lib/notifications/providers/meta-cloud-api.ts`, puros e testados sem
 * emulador e sem rede. Aqui fica so o que precisa do Secret Manager: o token
 * do usuario de sistema da Meta, que nunca entra no Firestore, no navegador
 * nem em arquivo versionado.
 *
 * **Um token, nao uma credencial por organizacao.** O token e do aplicativo da
 * Meta; qual numero envia vem do remetente aprovado em `messagingSenders`, no
 * `providerSenderId` de cada pedido. Por isso duas organizacoes nao se
 * alcancam: o Phone Number ID sai da organizacao dona da tarefa.
 */

/** Versao da Graph API usada quando o ambiente nao diz outra. */
export const DEFAULT_GRAPH_VERSION = "v25.0";

/**
 * O provedor pronto para o despachante. `null` quando o token nao esta
 * configurado — sem ele nada sai, e o canal que pedir a Cloud API falha com
 * mensagem clara em vez de enviar por outro caminho.
 */
export function metaCloudProviderFrom(env = process.env) {
  const token = env.META_WHATSAPP_TOKEN;
  if (!token) return null;
  return createMetaCloudApiProvider({
    graphVersion: env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
    authorization: () => `Bearer ${token}`,
  });
}
