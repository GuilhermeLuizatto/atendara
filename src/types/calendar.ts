import type { BusyBlock } from "@/lib/agenda/availability";

/**
 * Ocupado lido da agenda principal de um profissional (3C). Só faixas de tempo:
 * nenhum título, convidado ou descrição de evento externo chega aqui.
 */
export interface CalendarBusySnapshot {
  id: string;
  organizationId: string;
  professionalId: string;
  generation: string;
  blocks: BusyBlock[];
  timeMin: string;
  timeMax: string;
  readAt: string;
}

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
