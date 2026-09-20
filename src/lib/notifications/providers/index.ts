import { CHANNEL_META } from "@/config/notifications";
import type { OutboundChannel } from "@/types";

import { createSimulatedProvider } from "./simulated";
import type { NotificationProvider } from "./types";

export * from "./types";
export { createSimulatedProvider, SIMULATED_DESTINATIONS } from "./simulated";
export { createN8nBridgeProvider, BRIDGE_TIMEOUT_MS, type BridgeConfig } from "./n8n-bridge";

/**
 * Registro de provedores.
 *
 * A conferencia contra `CHANNEL_META` nao e cerimonia: e o que impede um canal
 * ser marcado como real na configuracao sem que exista implementacao — e
 * vice-versa.
 *
 * O simulado nasce aqui porque nao precisa de nada. Provedor que precisa de
 * segredo ou de rede — hoje so a ponte do n8n (13.3) — **nao** e construido
 * aqui: quem o monta e `functions/automation.js`, com o segredo do Secret
 * Manager, e o entrega em `overrides`. Assim este modulo continua sem I/O, e o
 * navegador nunca carrega codigo que fala com o n8n.
 */
export type ProviderOverrides = Partial<Record<string, () => NotificationProvider>>;

export function providerFor(channel: OutboundChannel, overrides: ProviderOverrides = {}): NotificationProvider {
  const expected = CHANNEL_META[channel].providerId;
  if (expected === "SIMULATED") return createSimulatedProvider();

  const factory = overrides[expected];
  if (!factory) {
    throw new Error(
      `Canal ${channel} declara o provedor ${expected}, que não foi configurado. Nenhuma mensagem sai sem ele.`,
    );
  }
  return factory();
}
