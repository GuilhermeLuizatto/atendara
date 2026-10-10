import { describe, expect, it } from "vitest";

import { LEAD_TEAM_TRANSITIONS, LEAD_WHATSAPP_CONSENT } from "@/config/leads";
import { NOTIFICATION_CONSENT_TEXT_VERSION } from "@/config/notifications";
import { renderReply } from "@/lib/notifications/replies";
import { MESSAGE_CLASSIFICATIONS, ROUTING_QUEUES } from "@/types";

import {
  canTeamMoveLead,
  grantLeadConsent,
  isLeadConsentAcceptance,
  leadConsentProblem,
  leadConsentState,
  leadRecipient,
  leadStatusAfterInbound,
  withdrawLeadConsent,
} from "./lifecycle";
import { routeContact } from "./routing";

const AGORA = "2026-10-09T12:00:00.000Z";

function classificacao(
  patch: Partial<Parameters<typeof routeContact>[0]["classification"]> = {},
) {
  return {
    classification: "ADMINISTRATIVE" as const,
    intent: "PRICING" as const,
    confidence: 0.95,
    ambiguous: false,
    ...patch,
  };
}

describe("encaminhamento do primeiro contato", () => {
  it("assunto administrativo vai para a fila da intenção", () => {
    const fila = (
      intent: NonNullable<Parameters<typeof classificacao>[0]>["intent"],
    ) =>
      routeContact({
        classification: classificacao({ intent }),
        confidenceThreshold: 0.85,
      }).queue;
    expect(fila("SCHEDULING")).toBe("AGENDA");
    expect(fila("CANCELLATION")).toBe("AGENDA");
    expect(fila("PAYMENT")).toBe("TENANT_FINANCE");
    expect(fila("PRICING")).toBe("COMMERCIAL");
    expect(fila("LOCATION")).toBe("ADMINISTRATIVE_SUPPORT");
    expect(fila("NONE")).toBe("HUMAN_REVIEW");
  });

  it("risco, urgência e conteúdo sensível vão para gente, qualquer que seja a intenção", () => {
    for (const classification of MESSAGE_CLASSIFICATIONS) {
      if (classification === "ADMINISTRATIVE" || classification === "FINANCIAL")
        continue;
      const decisao = routeContact({
        classification: classificacao({ classification, intent: "SCHEDULING" }),
        confidenceThreshold: 0.85,
      });
      expect(decisao, classification).toMatchObject({
        queue: "HUMAN_REVIEW",
        requiresHuman: true,
      });
    }
    expect(
      routeContact({
        classification: classificacao({ classification: "POSSIBLE_RISK" }),
        confidenceThreshold: 0.85,
      }).reason,
    ).toBe("POSSIBLE_RISK");
  });

  it("dúvida e baixa confiança vencem a intenção administrativa", () => {
    expect(
      routeContact({
        classification: classificacao({ ambiguous: true }),
        confidenceThreshold: 0.85,
      }),
    ).toEqual({ queue: "HUMAN_REVIEW", reason: "AMBIGUOUS", requiresHuman: true });
    expect(
      routeContact({
        classification: classificacao({ confidence: 0.6 }),
        confidenceThreshold: 0.85,
      }).reason,
    ).toBe("LOW_CONFIDENCE");
    expect(
      routeContact({
        classification: classificacao(),
        confidenceThreshold: Number.NaN,
      }).reason,
    ).toBe("LOW_CONFIDENCE");
  });

  it("assunto financeiro vai ao financeiro da organização, nunca a uma fila da plataforma", () => {
    const decisao = routeContact({
      classification: classificacao({ classification: "FINANCIAL", intent: "NONE" }),
      confidenceThreshold: 0.85,
    });
    expect(decisao.queue).toBe("TENANT_FINANCE");
    expect(ROUTING_QUEUES.some((fila) => fila.toLowerCase().includes("platform"))).toBe(false);
  });
});

describe("situação do lead", () => {
  it("nasce novo quando a Dara cuida e aguardando equipe quando precisa de gente", () => {
    expect(leadStatusAfterInbound(null, { requiresHuman: false, newer: true })).toBe("NEW");
    expect(leadStatusAfterInbound(null, { requiresHuman: true, newer: true })).toBe(
      "WAITING_TEAM",
    );
  });

  it("mensagem atrasada não muda nada, e assumido continua assumido", () => {
    for (const status of ["NEW", "WAITING_TEAM", "TAKEN_OVER", "CLOSED"] as const) {
      expect(leadStatusAfterInbound(status, { requiresHuman: true, newer: false })).toBe(
        status,
      );
    }
    expect(leadStatusAfterInbound("TAKEN_OVER", { requiresHuman: false, newer: true })).toBe(
      "TAKEN_OVER",
    );
    expect(leadStatusAfterInbound("WAITING_TEAM", { requiresHuman: false, newer: true })).toBe(
      "WAITING_TEAM",
    );
  });

  it("encerrado que volta a escrever volta para a equipe, nunca para novo", () => {
    expect(leadStatusAfterInbound("CLOSED", { requiresHuman: false, newer: true })).toBe(
      "WAITING_TEAM",
    );
  });

  it("a equipe assume e encerra; não devolve o lead à fila em silêncio", () => {
    expect(canTeamMoveLead("NEW", "TAKEN_OVER")).toBe(true);
    expect(canTeamMoveLead("TAKEN_OVER", "CLOSED")).toBe(true);
    expect(canTeamMoveLead("CLOSED", "TAKEN_OVER")).toBe(true);
    for (const [from, allowed] of Object.entries(LEAD_TEAM_TRANSITIONS)) {
      expect(allowed, from).not.toContain("NEW");
      expect(allowed, from).not.toContain("WAITING_TEAM");
    }
  });
});

describe("consentimento do lead", () => {
  it("só a frase que nomeia o canal autoriza; mensagem inicial não é consentimento", () => {
    expect(isLeadConsentAcceptance("Autorizo mensagens pelo WhatsApp")).toBe(true);
    expect(isLeadConsentAcceptance("  aceito receber mensagens pelo whatsapp ")).toBe(true);
    for (const texto of ["Oi", "sim", "aceito", "pode mandar", "Autorizo"]) {
      expect(isLeadConsentAcceptance(texto), texto).toBe(false);
    }
  });

  it("os termos pertencem à versão vigente do texto e não têm acento", () => {
    expect(LEAD_WHATSAPP_CONSENT.textVersion).toBe(NOTIFICATION_CONSENT_TEXT_VERSION);
    for (const termo of LEAD_WHATSAPP_CONSENT.acceptanceTerms) {
      expect(termo).toBe(termo.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase());
      expect(termo).toContain("WHATSAPP");
    }
  });

  it("autorização é da própria pessoa, por mensagem, na versão vigente", () => {
    const consentimento = grantLeadConsent(null, AGORA);
    const registro = consentimento.channels.WHATSAPP?.at(-1);
    expect(registro).toMatchObject({
      textVersion: NOTIFICATION_CONSENT_TEXT_VERSION,
      granted: { at: AGORA, recordedBy: { kind: "SUBJECT", userId: null }, medium: "MESSAGE" },
      withdrawn: null,
    });
    expect(leadConsentState(consentimento)).toBe("GRANTED");
    expect(leadConsentProblem(consentimento)).toBeNull();
  });

  it("sem registro, retirado ou de texto anterior não autoriza", () => {
    expect(leadConsentProblem(null)).toBe("MISSING_CONSENT");

    const retirado = withdrawLeadConsent(grantLeadConsent(null, AGORA), AGORA);
    expect(leadConsentState(retirado)).toBe("WITHDRAWN");
    expect(leadConsentProblem(retirado)).toBe("CONSENT_REVOKED");

    const antigo = grantLeadConsent(null, AGORA);
    antigo.channels.WHATSAPP![0] = { ...antigo.channels.WHATSAPP![0], textVersion: "versao-antiga" };
    expect(leadConsentProblem(antigo)).toBe("CONSENT_TEXT_OUTDATED");

    // Autorizar de novo encerra o registro antigo e acrescenta o vigente.
    const renovado = grantLeadConsent(antigo, "2026-10-10T12:00:00.000Z");
    expect(renovado.channels.WHATSAPP).toHaveLength(2);
    expect(renovado.channels.WHATSAPP![0].withdrawn).not.toBeNull();
    expect(leadConsentState(renovado)).toBe("GRANTED");
  });

  it("lead vira destinatário só com consentimento vigente, e sem nome inventado", () => {
    const lead = { id: "lead-1", phone: "+5513999990000", notificationConsent: null };
    expect(leadRecipient(lead)).toBeNull();
    const destinatario = leadRecipient({
      ...lead,
      notificationConsent: grantLeadConsent(null, AGORA),
    });
    expect(destinatario).toMatchObject({
      id: "lead-1",
      fullName: "",
      preferredName: null,
      phone: "+5513999990000",
    });
  });

  it("a resposta ao lead cumprimenta sem nome", () => {
    const texto = renderReply("ADMINISTRATIVE_REPLY", "REQUEST", {
      clientName: "",
      organizationName: "Consultório Fictício",
      responseText: "O valor da consulta está na tabela da organização.",
    });
    expect(texto).toMatchObject({ ok: true });
    if (texto.ok) {
      expect(texto.value.startsWith("Olá! Aqui é a Dara")).toBe(true);
    }
  });

});
