import { describe, expect, it } from "vitest";

import type { PlatformSubscription } from "@/types";

import { accessSummary, type GrantForAccess } from "./access-summary";

const AGORA = new Date("2026-09-20T12:00:00.000Z");

function assinatura(patch: Partial<PlatformSubscription> = {}) {
  return {
    accessUntil: "2026-10-09T12:00:00.000Z",
    status: "ACTIVE" as const,
    refundedAt: null,
    ...patch,
  };
}

function concessao(patch: Partial<GrantForAccess> = {}): GrantForAccess {
  return { until: "2026-10-02T12:00:00.000Z", revokedAt: null, kind: "TRIAL", ...patch };
}

describe("ate quando o acesso vale", () => {
  it("vale a data mais distante entre assinatura e concessao", () => {
    const comTeste = accessSummary({
      subscription: assinatura({ accessUntil: "2026-09-19T12:00:00.000Z", status: "PAST_DUE" }),
      grant: concessao(),
      now: AGORA,
    });

    // Era este o texto errado de 19/09: a tela dizia "acesso ate 19/09" para
    // quem tinha teste ate 02/10.
    expect(comTeste.accessUntil).toBe("2026-10-02T12:00:00.000Z");
    expect(comTeste.fromGrant).toBe(true);
  });

  it("quando a assinatura vai mais longe, a data e dela", () => {
    const resumo = accessSummary({ subscription: assinatura(), grant: concessao(), now: AGORA });

    expect(resumo.accessUntil).toBe("2026-10-09T12:00:00.000Z");
    expect(resumo.fromGrant).toBe(false);
  });

  it("concessao vencida ou revogada nao conta", () => {
    const vencida = accessSummary({
      subscription: assinatura({ accessUntil: "2026-09-19T12:00:00.000Z" }),
      grant: concessao({ until: "2026-09-01T12:00:00.000Z" }),
      now: AGORA,
    });
    const revogada = accessSummary({
      subscription: assinatura({ accessUntil: "2026-09-19T12:00:00.000Z" }),
      grant: concessao({ revokedAt: "2026-09-10T12:00:00.000Z" }),
      now: AGORA,
    });

    expect(vencida.accessUntil).toBe("2026-09-19T12:00:00.000Z");
    expect(revogada.accessUntil).toBe("2026-09-19T12:00:00.000Z");
  });

  it("sem assinatura e sem concessao, nao ha data para mostrar", () => {
    expect(accessSummary({ subscription: null, grant: null, now: AGORA }).accessUntil).toBeNull();
  });
});

describe("teste do autocadastro", () => {
  it("e reconhecido como teste, e nao como liberacao da operadora", () => {
    const resumo = accessSummary({ subscription: null, grant: concessao(), now: AGORA });
    expect(resumo.isTrial).toBe(true);
  });

  it("concessao da operadora continua sendo da operadora", () => {
    for (const kind of ["COURTESY", "PILOT", "CORRECTION"] as const) {
      expect(accessSummary({ subscription: null, grant: concessao({ kind }), now: AGORA }).isTrial).toBe(false);
    }
  });
});

describe("devolucao nao e inadimplencia", () => {
  it("reembolsado e reconhecido, mesmo o estado sendo PAST_DUE", () => {
    const resumo = accessSummary({
      subscription: assinatura({ status: "PAST_DUE", refundedAt: "2026-09-19T12:00:00.000Z" }),
      grant: null,
      now: AGORA,
    });
    expect(resumo.refunded).toBe(true);
  });

  it("quem nao pagou nao vira reembolsado", () => {
    expect(accessSummary({ subscription: assinatura({ status: "PAST_DUE" }), grant: null, now: AGORA }).refunded).toBe(
      false,
    );
  });

  it("reembolso antigo com assinatura nova em dia nao marca a tela", () => {
    const resumo = accessSummary({
      subscription: assinatura({ status: "ACTIVE", refundedAt: "2026-08-01T12:00:00.000Z" }),
      grant: null,
      now: AGORA,
    });
    expect(resumo.refunded).toBe(false);
  });
});
