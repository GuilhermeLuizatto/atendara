import {
  ACCESS_GRANT_REASON_LENGTH,
  MAX_ACCESS_GRANT_DAYS,
  PLATFORM_ADMIN_SECOND_FACTORS,
} from "@/config/platform";
import { toAccountSubscriptionStatus } from "@/lib/billing/policy";
import type { ISODateString, PlatformSubscriptionStatus } from "@/types";

/**
 * O portao de acesso da conta quando existem DUAS origens de validade: a
 * assinatura confirmada pelo gateway e a concessao registrada pela operadora.
 *
 * Funcoes puras, compartilhadas com o backend por `build-functions.mjs`. Quem
 * aplica e o backend — o webhook e as callables de concessao, dentro da mesma
 * transacao que le as duas origens.
 */

const DAY_MS = 86_400_000;

export interface AccountGate {
  subscriptionStatus: "ACTIVE" | "PENDING" | "CANCELLED";
  accessUntil: ISODateString | null;
}

export interface SubscriptionSource {
  status: PlatformSubscriptionStatus;
  accessUntil: ISODateString | null;
}

export interface GrantSource {
  until: ISODateString;
  revokedAt: ISODateString | null;
}

export function isGrantInForce(grant: GrantSource | null | undefined, nowMs: number): boolean {
  return Boolean(grant && !grant.revokedAt && Date.parse(grant.until) > nowMs);
}

/**
 * A maior validade entre as duas origens vigentes.
 *
 * - Evento `INCOMPLETE`, `PAST_DUE` ou reembolso nao fecha uma concessao
 *   vigente: a assinatura deixa de abrir, a concessao continua abrindo.
 * - Concessao nunca encurta ciclo pago: se a assinatura vai mais longe, vale ela.
 * - Sem concessao vigente, o portao e exatamente o que a assinatura diz — e a
 *   revogacao antecipada fecha so a parte concedida.
 */
export function resolveAccountGate(input: {
  subscription: SubscriptionSource | null | undefined;
  grant: GrantSource | null | undefined;
  nowMs: number;
}): AccountGate {
  const { subscription, grant, nowMs } = input;
  const paid: AccountGate | null = subscription
    ? {
        subscriptionStatus: toAccountSubscriptionStatus(subscription.status),
        accessUntil: subscription.accessUntil,
      }
    : null;

  if (!grant || !isGrantInForce(grant, nowMs)) {
    return paid ?? { subscriptionStatus: "PENDING", accessUntil: null };
  }

  const paidOpen =
    paid?.subscriptionStatus === "ACTIVE" &&
    paid.accessUntil !== null &&
    Date.parse(paid.accessUntil) > nowMs;
  if (paid && paidOpen && Date.parse(paid.accessUntil!) >= Date.parse(grant.until)) {
    return paid;
  }
  return { subscriptionStatus: "ACTIVE", accessUntil: grant.until };
}

/** `null` quando a validade pedida cabe na politica; senao, o motivo. */
export function accessGrantWindowError(until: ISODateString, nowMs: number): string | null {
  const untilMs = Date.parse(until);
  if (!Number.isFinite(untilMs) || untilMs <= nowMs) return "Defina uma validade futura.";
  if (untilMs > nowMs + MAX_ACCESS_GRANT_DAYS * DAY_MS) {
    return `A concessão vale no máximo ${MAX_ACCESS_GRANT_DAYS} dias. Para ir além, conceda de novo com novo motivo.`;
  }
  return null;
}

export function accessGrantReasonError(reason: string): string | null {
  const length = reason.trim().length;
  if (length < ACCESS_GRANT_REASON_LENGTH.min) return "Explique o motivo da concessão.";
  if (length > ACCESS_GRANT_REASON_LENGTH.max) return "Resuma o motivo da concessão.";
  return null;
}

/**
 * Segundo fator exigido da operadora, lido do token decodificado.
 *
 * O token chega verificado pelo SDK das functions; aqui so se confere qual
 * fator a sessao usou. Ausente, desconhecido ou de outro tipo: recusa.
 */
export function hasRequiredSecondFactor(token: unknown): boolean {
  if (!token || typeof token !== "object") return false;
  const firebase = (token as { firebase?: unknown }).firebase;
  if (!firebase || typeof firebase !== "object") return false;
  const factor = (firebase as { sign_in_second_factor?: unknown }).sign_in_second_factor;
  return typeof factor === "string" && PLATFORM_ADMIN_SECOND_FACTORS.includes(factor);
}
