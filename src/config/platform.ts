import type { AccessGrantKind, PlatformAuditAction } from "@/types/platform";

/**
 * Politica da operadora da plataforma, como DADO.
 *
 * Compartilhado com o backend por `scripts/build-functions.mjs`, como
 * `billing.ts`. As Security Rules nao importam TypeScript: o fator exigido
 * aparece literal em `platformAdmin()` e precisa mudar junto daqui.
 */

/**
 * Fatores aceitos para a operadora. O valor e o id do fator gravado em
 * `firebase.sign_in_second_factor` no token.
 *
 * So TOTP, por decisao do titular. SMS fica de fora mesmo que o
 * projeto venha a habilita-lo para outro publico. Se o token real trouxer outro
 * valor, a trava fecha: a operadora perde a administracao, e nenhum dado abre.
 */
export const PLATFORM_ADMIN_SECOND_FACTORS: readonly string[] = ["totp"];

/**
 * Prazo maximo de uma concessao manual, contado a partir do ato. Renovar exige
 * nova concessao, com novo motivo. Quinze dias por decisao do titular em
 * 11/09/2026, revisavel: curto o bastante para que uma cortesia esquecida nao
 * vire acesso gratuito permanente.
 */
export const MAX_ACCESS_GRANT_DAYS = 15;

export const ACCESS_GRANT_REASON_LENGTH = { min: 10, max: 500 } as const;

export const ACCESS_GRANT_KIND_LABELS: Record<AccessGrantKind, string> = {
  COURTESY: "Cortesia",
  PILOT: "Piloto",
  CORRECTION: "Correção",
};

export const PLATFORM_AUDIT_ACTION_LABELS: Record<PlatformAuditAction, string> = {
  ACCOUNT_REGISTERED: "Cadastro de profissional",
  ACCOUNT_UPDATED: "Alteração de conta",
  ACCESS_GRANTED: "Concessão de acesso",
  ACCESS_REVOKED: "Revogação de acesso",
  PLATFORM_ADMIN_CREATED: "Cadastro de administrador",
  PLATFORM_ADMIN_SUSPENDED: "Suspensão de administrador",
  PLATFORM_ADMIN_REACTIVATED: "Reativação de administrador",
  ORGANIZATION_DELETED: "Exclusão de organização pelo titular",
};

/**
 * Teto por usuario nas callables que falam com o gateway ou que destroem dado.
 * Uma conta autenticada nao pode gastar a cota da conta do gateway que atende
 * todos os tenants, e uma sessao comprometida nao elimina o cadastro inteiro
 * de uma clinica num laco. Janela fixa: simples de provar e suficiente contra
 * volume.
 */
export const CALLABLE_RATE_LIMITS = {
  createSubscriptionCheckout: { max: 5, windowSeconds: 600 },
  openBillingPortal: { max: 10, windowSeconds: 600 },
  cancelPlatformSubscription: { max: 3, windowSeconds: 600 },
  eraseClientData: { max: 10, windowSeconds: 600 },
  deleteOrganization: { max: 3, windowSeconds: 600 },
} as const;

export type RateLimitedCallable = keyof typeof CALLABLE_RATE_LIMITS;

/**
 * Retencao PROVISORIA, em dias, gravada como `expiresAt` para uma futura
 * politica de TTL. Nenhum destes prazos foi aprovado por revisao juridica, e a
 * politica de TTL nao esta ligada para colecao nenhuma com dado de pessoa.
 *
 * `platformGatewayEvents` precisa sobreviver bem alem da janela de reenvio do
 * gateway: e a trava de idempotencia.
 */
export const PROVISIONAL_RETENTION_DAYS = {
  platformGatewayEvents: 400,
} as const;
