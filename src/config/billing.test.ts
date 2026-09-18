import { describe, expect, it } from "vitest";

import { PLATFORM_PLANS } from "./billing";

describe("catalogo de planos", () => {
  it("nenhum plano pede teste gratuito a Stripe", () => {
    // Decisao de 17/09/2026: o teste gratuito vive so no Atendara (14 dias). Um
    // teste na Stripe se somaria a ele, e a assinatura nasceria sem cobrar.
    for (const plan of PLATFORM_PLANS) expect(plan.trialDays, plan.id).toBe(0);
  });

  it("preco em centavos inteiros", () => {
    for (const plan of PLATFORM_PLANS) expect(Number.isInteger(plan.priceInCents), plan.id).toBe(true);
  });
});
