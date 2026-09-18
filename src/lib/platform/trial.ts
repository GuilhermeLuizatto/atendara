import { BLOCKED_RETENTION_DAYS, TRIAL_ENDING_NOTICE_DAYS } from "@/config/platform";
import type { AccountAccess } from "@/types/access";

/**
 * Em que ponto do teste de 14 dias uma conta esta.
 *
 * Funcao pura, compartilhada com o backend por `build-functions.mjs`: a rotina
 * que bloqueia e o painel que avisa precisam concordar sobre o que e "vencido".
 * Duas contas da mesma data em lugares diferentes dariam telas que se
 * contradizem.
 *
 * Arquivo de dominio: nao importa `firebase/*`.
 */

const DAY_MS = 86_400_000;

export type TrialPhase =
  /** Conta que nao veio do cadastro aberto, ou que ainda nao confirmou o e-mail. */
  | "NONE"
  /** Teste correndo, com folga. */
  | "RUNNING"
  /** Teste correndo, perto do fim: o painel avisa. */
  | "ENDING"
  /** Vencido. O painel fecha; pagar, exportar e apagar continuam. */
  | "BLOCKED";

export interface TrialState {
  phase: TrialPhase;
  /** Dias inteiros que faltam, arredondados para cima. Zero quando vencido. */
  daysLeft: number;
  /** Dias que faltam para a pseudonimizacao, quando ja bloqueada. */
  daysUntilErasure: number | null;
}

const NOT_A_TRIAL: TrialState = { phase: "NONE", daysLeft: 0, daysUntilErasure: null };

/**
 * `accessUntil` e a unica fonte da data: ele vem da concessao registrada, e
 * nenhuma tela o calcula por conta propria.
 */
export function trialState(
  account: Pick<AccountAccess, "origin" | "accessUntil" | "blockedSince" | "subscribedAt"> | null | undefined,
  nowMs: number,
): TrialState {
  if (!account || account.origin !== "SELF_SERVICE" || !account.accessUntil) return NOT_A_TRIAL;
  // Quem ja assinou saiu do teste: a validade dali em diante e a do ciclo pago,
  // e avisar "seu teste termina" a quem esta pagando seria mentira.
  if (account.subscribedAt) return NOT_A_TRIAL;

  const endsAt = Date.parse(account.accessUntil);
  if (!Number.isFinite(endsAt)) return NOT_A_TRIAL;

  if (endsAt <= nowMs) {
    // Sem a marca da rotina, o prazo de retencao conta do vencimento: a conta
    // nao fica com prazo aberto so porque a rotina ainda nao passou.
    const blockedSince = account.blockedSince ? Date.parse(account.blockedSince) : endsAt;
    const erasureAt = blockedSince + BLOCKED_RETENTION_DAYS * DAY_MS;
    return {
      phase: "BLOCKED",
      daysLeft: 0,
      daysUntilErasure: Math.max(0, Math.ceil((erasureAt - nowMs) / DAY_MS)),
    };
  }

  const daysLeft = Math.ceil((endsAt - nowMs) / DAY_MS);
  return {
    phase: daysLeft <= TRIAL_ENDING_NOTICE_DAYS ? "ENDING" : "RUNNING",
    daysLeft,
    daysUntilErasure: null,
  };
}
