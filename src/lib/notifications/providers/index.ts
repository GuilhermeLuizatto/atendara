import { CHANNEL_META } from "@/config/notifications";
import type { OutboundChannel } from "@/types";

import { createSimulatedProvider } from "./simulated";
import type { NotificationProvider } from "./types";

export * from "./types";
export { createSimulatedProvider, SIMULATED_DESTINATIONS } from "./simulated";

/**
 * Registro de provedores.
 *
 * Existe um so, e este arquivo e o lugar onde o segundo tera de ser declarado.
 * A conferencia contra `CHANNEL_META` nao e cerimonia: e o que impede um canal
 * ser marcado como real na configuracao sem que exista implementacao — e
 * vice-versa.
 */
export function providerFor(channel: OutboundChannel): NotificationProvider {
  const expected = CHANNEL_META[channel].providerId;
  if (expected !== "SIMULATED") {
    throw new Error(
      `Canal ${channel} declara o provedor ${expected}, que não existe. Nenhum envio real está implementado.`,
    );
  }
  return createSimulatedProvider();
}
