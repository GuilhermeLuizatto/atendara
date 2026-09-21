/** Configuração pública necessária para abrir o Embedded Signup da Meta. */

export const META_EMBEDDED_SIGNUP = {
  appId: process.env.NEXT_PUBLIC_META_APP_ID ?? "",
  configId: process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID ?? "",
  graphVersion: process.env.NEXT_PUBLIC_META_GRAPH_VERSION ?? "v25.0",
} as const;

export function isMetaEmbeddedSignupConfigured(): boolean {
  return Boolean(META_EMBEDDED_SIGNUP.appId && META_EMBEDDED_SIGNUP.configId);
}
