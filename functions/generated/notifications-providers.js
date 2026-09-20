// Gerado por scripts/build-functions.mjs.
import { CHANNEL_META } from "./notifications-config.js";
import { createSimulatedProvider } from "./notifications-providers-simulated.js";
export * from "./notifications-providers-types.js";
export { createSimulatedProvider, SIMULATED_DESTINATIONS } from "./notifications-providers-simulated.js";
export { createN8nBridgeProvider, BRIDGE_TIMEOUT_MS } from "./notifications-providers-n8n-bridge.js";
export function providerFor(channel, overrides = {}) {
    const expected = CHANNEL_META[channel].providerId;
    if (expected === "SIMULATED")
        return createSimulatedProvider();
    const factory = overrides[expected];
    if (!factory) {
        throw new Error(`Canal ${channel} declara o provedor ${expected}, que não foi configurado. Nenhuma mensagem sai sem ele.`);
    }
    return factory();
}
