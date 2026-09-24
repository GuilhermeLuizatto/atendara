import { describe, expect, it, vi } from "vitest";

import type { MessagingSender, NotificationRule } from "@/types";

import { evaluateConversationReply, type ConversationReplyInput } from "./eligibility";
import { ANCHOR, FICTITIOUS, client, consent, consentRecord, organization } from "./fixtures";

/**
 * O portão da resposta da assistente (etapa 1 da proposta de 24/09).
 *
 * A tarefa que leva a resposta até a pessoa é a etapa 2. Até lá a tabela
 * `NOTICE_TASK_TYPES` diz `null` para as respostas, e o portão recusa tudo com
 * `EVENT_WITHOUT_AUTOMATION` — o primeiro teste confere isso com a tabela real.
 * Os demais simulam a tabela da etapa 2 para alcançar cada trava seguinte.
 */

const etapa2 = vi.hoisted(() => ({ ligada: false }));

vi.mock("@/config/automation", async (original) => {
  const real = await original<typeof import("@/config/automation")>();
  return {
    ...real,
    NOTICE_TASK_TYPES: new Proxy(real.NOTICE_TASK_TYPES, {
      get: (tabela, evento) =>
        etapa2.ligada && typeof evento === "string" && evento.startsWith("RESCHEDULE_")
          ? "SEND_REMINDER"
          : tabela[evento as keyof typeof tabela],
    }),
  };
});

const { getProfession } = await import("@/config/professions");

const DEPOIS_DA_MENSAGEM = "2026-09-11T12:00:00.000Z"; // janela aberta até aqui
const HORARIOS = [{ startsAt: "2026-09-14T11:00:00.000Z" }, { startsAt: "2026-09-14T11:30:00.000Z" }];

function regra(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "RESCHEDULE_OFFERED:WHATSAPP",
    event: "RESCHEDULE_OFFERED",
    channel: "WHATSAPP",
    enabled: true,
    leadMinutes: 0,
    customTemplate: null,
    ...overrides,
  };
}

function remetente(overrides: Partial<MessagingSender> = {}): MessagingSender {
  return {
    id: "WHATSAPP",
    organizationId: "org-teste",
    channel: "WHATSAPP",
    providerId: "N8N_BRIDGE",
    providerSenderId: "1236644296208358",
    displayNumber: "+5513999990000",
    displayName: "Estúdio Exemplo",
    status: "APPROVED",
    mode: "TEST",
    testRecipients: [FICTITIOUS.phone],
    lastReason: "Remetente de teste autorizado.",
    createdAt: ANCHOR,
    createdBy: "operadora",
    updatedAt: ANCHOR,
    updatedBy: "operadora",
    ...overrides,
  };
}

function entrada(overrides: Partial<ConversationReplyInput> = {}): ConversationReplyInput {
  const org = overrides.organization ?? organization({ verifiedSenderChannels: ["WHATSAPP"], rules: [regra()] });
  return {
    organization: org,
    profession: getProfession(org.primaryProfession),
    client: client(),
    sender: remetente(),
    event: "RESCHEDULE_OFFERED",
    stage: "REQUEST",
    channel: "WHATSAPP",
    conversation: { escalated: false, attention: "NORMAL", inboundWindowEndsAt: DEPOIS_DA_MENSAGEM },
    now: ANCHOR,
    validUntil: "2026-09-10T12:10:00.000Z",
    details: { slots: HORARIOS },
    ...overrides,
  };
}

function motivo(overrides: Partial<ConversationReplyInput> = {}) {
  const resultado = evaluateConversationReply(entrada(overrides));
  return resultado.eligible ? "ELIGIBLE" : resultado.reason;
}

describe("hoje, antes da etapa 2", () => {
  it("nenhuma resposta sai: não há tarefa que a leve", () => {
    etapa2.ligada = false;
    expect(motivo()).toBe("EVENT_WITHOUT_AUTOMATION");
  });
});

describe("com a tarefa da etapa 2", () => {
  const comEtapa2 = (overrides: Partial<ConversationReplyInput> = {}) => {
    etapa2.ligada = true;
    try {
      return motivo(overrides);
    } finally {
      etapa2.ligada = false;
    }
  };

  it("com tudo em ordem, sai para o contato do cadastro, com o texto da oferta", () => {
    etapa2.ligada = true;
    const resultado = evaluateConversationReply(entrada());
    etapa2.ligada = false;

    expect(resultado).toMatchObject({ eligible: true, destination: FICTITIOUS.phone });
    if (resultado.eligible) expect(resultado.body).toContain("1. segunda-feira, 14 de setembro, às 08:00");
  });

  describe("as travas da regra 11 valem para a resposta", () => {
    it("chave da organização desligada", () => {
      expect(
        comEtapa2({
          organization: organization({ enabled: false, verifiedSenderChannels: ["WHATSAPP"], rules: [regra()] }),
        }),
      ).toBe("ORGANIZATION_DISABLED");
    });

    it("sem regra para a resposta, ou regra desligada", () => {
      expect(comEtapa2({ organization: organization({ verifiedSenderChannels: ["WHATSAPP"], rules: [] }) })).toBe(
        "NO_RULE_FOR_EVENT",
      );
      expect(
        comEtapa2({
          organization: organization({ verifiedSenderChannels: ["WHATSAPP"], rules: [regra({ enabled: false })] }),
        }),
      ).toBe("RULE_DISABLED");
    });

    it("regra de outra resposta não autoriza esta", () => {
      expect(
        comEtapa2({
          organization: organization({
            verifiedSenderChannels: ["WHATSAPP"],
            rules: [regra({ id: "RESCHEDULE_CONFIRMED:WHATSAPP", event: "RESCHEDULE_CONFIRMED" })],
          }),
        }),
      ).toBe("NO_RULE_FOR_EVENT");
    });

    it("remetente não comprovado, não cadastrado ou não aprovado", () => {
      expect(comEtapa2({ organization: organization({ verifiedSenderChannels: [], rules: [regra()] }) })).toBe(
        "SENDER_NOT_VERIFIED",
      );
      expect(comEtapa2({ sender: null })).toBe("SENDER_NOT_REGISTERED");
      expect(comEtapa2({ sender: remetente({ status: "PENDING" }) })).toBe("SENDER_NOT_APPROVED");
    });

    it("em modo de teste, destino fora da lista de testadores", () => {
      expect(comEtapa2({ sender: remetente({ testRecipients: ["+5500911111111"] }) })).toBe(
        "DESTINATION_NOT_IN_TEST_LIST",
      );
    });

    it("sem consentimento, com consentimento só de outro canal, ou retirado", () => {
      expect(comEtapa2({ client: client({ appointmentNotificationsEnabled: false }) })).toBe("MISSING_CONSENT");
      expect(comEtapa2({ client: client({ notificationConsent: consent({ EMAIL: [consentRecord()] }) }) })).toBe(
        "CHANNEL_NOT_CONSENTED",
      );
      expect(
        comEtapa2({
          client: client({
            notificationConsent: consent({
              WHATSAPP: [consentRecord({ withdrawn: { at: ANCHOR, recordedBy: { kind: "SUBJECT", userId: null }, medium: "MESSAGE" } })],
            }),
          }),
        }),
      ).toBe("CONSENT_REVOKED");
    });

    it("sem contato válido", () => {
      expect(comEtapa2({ client: client({ phone: null }) })).toBe("MISSING_CONTACT");
    });
  });

  describe("o que só a conversa sabe", () => {
    it("número sem cadastro único não recebe resposta", () => {
      expect(comEtapa2({ client: null })).toBe("CLIENT_NOT_IDENTIFIED");
    });

    it("conversa com a equipe ou crítica não recebe automação", () => {
      expect(
        comEtapa2({ conversation: { escalated: true, attention: "HIGH", inboundWindowEndsAt: DEPOIS_DA_MENSAGEM } }),
      ).toBe("CONVERSATION_WITH_HUMAN");
      expect(
        comEtapa2({
          conversation: { escalated: false, attention: "CRITICAL", inboundWindowEndsAt: DEPOIS_DA_MENSAGEM },
        }),
      ).toBe("CONVERSATION_WITH_HUMAN");
    });

    it("fora das 24 horas que a pessoa abriu, ou sem janela registrada", () => {
      expect(comEtapa2({ now: "2026-09-11T12:00:01.000Z", validUntil: null })).toBe("REPLY_WINDOW_CLOSED");
      expect(
        comEtapa2({ conversation: { escalated: false, attention: "NORMAL", inboundWindowEndsAt: undefined } }),
      ).toBe("REPLY_WINDOW_CLOSED");
    });

    it("oferta com a reserva vencida não sai", () => {
      expect(comEtapa2({ now: "2026-09-10T12:10:01.000Z" })).toBe("REPLY_EXPIRED");
    });

    it("texto que não se completa não sai", () => {
      expect(comEtapa2({ details: { slots: [] } })).toBe("TEMPLATE_REJECTED");
    });
  });
});
