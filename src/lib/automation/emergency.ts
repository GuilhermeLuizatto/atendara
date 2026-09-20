import type { ISODateString } from "@/types";

/**
 * A chave de emergência (Fase 3, 13.9), sem I/O.
 *
 * Duas chaves, e as duas param a saída na hora:
 *
 * - **da organização**, do titular: cala a saída daquela clínica;
 * - **geral**, da chave mestra com segundo fator: cala a saída de todas.
 *
 * Elas não se anulam — a geral não liga a saída de quem desligou a própria, e
 * desligar a da organização não depende da geral. Para uma mensagem sair, as
 * duas precisam estar ligadas.
 *
 * **Parar não é cancelar.** Tarefa parada continua na fila, com estado e
 * tentativa intactos. Ao religar, ela sai — e é por isso que a chave é
 * reversível sem perder aviso.
 */

export interface AutomationSwitch {
  /** `false` = saída suspensa. */
  enabled: boolean;
  /** Motivo escrito por quem desligou, para a trilha e para a tela. */
  reason: string | null;
  changedAt: ISODateString | null;
  changedBy: string | null;
}

export const AUTOMATION_SWITCH_ON: AutomationSwitch = {
  enabled: true,
  reason: null,
  changedAt: null,
  changedBy: null,
};

export type OutboundBlock = "GLOBAL_SWITCH_OFF" | "ORGANIZATION_SWITCH_OFF";

/**
 * A saída pode acontecer agora?
 *
 * Ausente é ligada: uma organização que nunca tocou na chave não fica muda por
 * omissão. O que desliga é sempre um ato registrado.
 */
export function outboundBlock(input: {
  global: Pick<AutomationSwitch, "enabled"> | null;
  organization: Pick<AutomationSwitch, "enabled"> | null;
}): OutboundBlock | null {
  if (input.global && input.global.enabled === false) return "GLOBAL_SWITCH_OFF";
  if (input.organization && input.organization.enabled === false) return "ORGANIZATION_SWITCH_OFF";
  return null;
}

export const OUTBOUND_BLOCK_LABELS: Record<OutboundBlock, string> = {
  GLOBAL_SWITCH_OFF: "A saída de mensagens está suspensa para toda a plataforma.",
  ORGANIZATION_SWITCH_OFF: "A saída de mensagens está suspensa nesta organização.",
};

/**
 * Quanto tempo a tarefa parada espera antes de tentar de novo.
 *
 * Curto o bastante para a fila voltar sozinha logo depois de religar, e longo
 * o bastante para não transformar uma chave desligada por um dia inteiro em
 * milhares de tentativas.
 */
export const SWITCH_RETRY_MINUTES = 15;

export function switchRetryAt(now: ISODateString): ISODateString {
  return new Date(Date.parse(now) + SWITCH_RETRY_MINUTES * 60_000).toISOString();
}
