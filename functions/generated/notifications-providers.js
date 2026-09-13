// Gerado por scripts/build-functions.mjs.
import { CHANNEL_META } from "./notifications-config.js";
import { createSimulatedProvider } from "./notifications-providers-simulated.js";
export * from "./notifications-providers-types.js";
export { createSimulatedProvider, SIMULATED_DESTINATIONS } from "./notifications-providers-simulated.js";
/**
 * Registro de provedores.
 *
 * Existe um so, e este arquivo e o lugar onde o segundo tera de ser declarado.
 * A conferencia contra `CHANNEL_META` nao e cerimonia: e o que impede um canal
 * ser marcado como real na configuracao sem que exista implementacao — e
 * vice-versa.
 */
export function providerFor(channel) {
    const expected = CHANNEL_META[channel].providerId;
    if (expected !== "SIMULATED") {
        throw new Error(`Canal ${channel} declara o provedor ${expected}, que não existe. Nenhum envio real está implementado.`);
    }
    return createSimulatedProvider();
}
