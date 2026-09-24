import type { BusyBlock } from "@/lib/agenda/availability";

/** Resposta pública; a credencial cifrada existe apenas no backend. */
export interface CalendarConnectionView {
  configured: boolean;
  status: "CONNECTED" | "REVOKED" | "ERROR";
  /** Os atendimentos estão indo para a agenda "Atendara" no Google. */
  writeEnabled: boolean;
  connectedAt: string | null;
  lastError: "UNAVAILABLE" | "RECONNECT_REQUIRED" | null;
  snapshot: {
    readAt: string;
    timeMin: string;
    timeMax: string;
    blocks: BusyBlock[];
  } | null;
}
